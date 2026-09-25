// ============================================================
//  DramaWorld Telegram Bot - نسخة Webhook (Render Ready)
// ============================================================

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

// ==================== خادم Express ====================
const app = express();
app.use(express.json());

// نقطة فحص الصحة (تمنع Render من النوم عند ping)
app.get('/', (req, res) => {
  res.send('🤖 DramaWorld Bot is running!');
});

// نقطة استقبال Webhook من تليجرام
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// تشغيل الخادم
app.listen(PORT, () => {
  console.log(`✅ الخادم يعمل على المنفذ ${PORT}`);
});

// ==================== إنشاء البوت ====================
const bot = new TelegramBot(BOT_TOKEN);

// تعيين Webhook (فقط في الإنتاج)
if (RENDER_URL) {
  const webhookUrl = `${RENDER_URL}/webhook/${BOT_TOKEN}`;
  bot.setWebHook(webhookUrl)
    .then(() => console.log(`🔗 تم تعيين Webhook: ${webhookUrl}`))
    .catch(err => console.error('❌ فشل تعيين Webhook:', err.message));
}

// تخزين مؤقت للمستخدمين المصرح لهم
const authorizedUsers = new Set();
const userStates = new Map();

// ==================== دوال الاتصال بـ Google Script ====================
async function callScript(action, params = {}) {
  try {
    const query = new URLSearchParams({ action, ...params }).toString();
    const response = await axios.get(`${SCRIPT_URL}?${query}`, { timeout: 30000 });
    return response.data;
  } catch (error) {
    console.error('خطأ في الاتصال:', error.message);
    return { success: false, error: error.message };
  }
}

// ==================== التحقق من صلاحيات المشرف ====================
function isAdmin(chatId) {
  if (ADMIN_CHAT_ID && String(chatId) === String(ADMIN_CHAT_ID)) return true;
  return authorizedUsers.has(String(chatId));
}

// ==================== القوائم ====================
function getMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 الإحصائيات', callback_data: 'stats' }],
        [{ text: '🔑 إدارة المفاتيح', callback_data: 'manage_keys' }],
        [{ text: '📋 الطلبات', callback_data: 'orders' }],
        [{ text: '👥 المشتركين', callback_data: 'subscribers' }],
        [{ text: '🔍 البحث عن مفتاح', callback_data: 'search_key' }],
        [{ text: '➕ إنشاء مفتاح يدوي', callback_data: 'create_key' }],
        [{ text: '❓ مساعدة', callback_data: 'help' }]
      ]
    }
  };
}

function getKeysMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ المفاتيح النشطة', callback_data: 'keys_active_0' }],
        [{ text: '⏰ المفاتيح المنتهية', callback_data: 'keys_expired_0' }],
        [{ text: '🚫 المفاتيح الملغاة', callback_data: 'keys_revoked_0' }],
        [{ text: '📋 كل المفاتيح', callback_data: 'keys_all_0' }],
        [{ text: '⬅️ رجوع', callback_data: 'main_menu' }]
      ]
    }
  };
}

// ==================== الإحصائيات ====================
async function showStats(chatId, messageId = null) {
  const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري تحميل الإحصائيات...');
  
  const result = await callScript('stats', { pass: ADMIN_PASSWORD });
  
  await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
  
  if (!result.success || !result.stats) {
    return bot.sendMessage(chatId, '❌ فشل في جلب الإحصائيات', getMainMenu());
  }
  
  const s = result.stats;
  const text = 
    `📊 *إحصائيات DramaWorld*\n\n` +
    `🔑 *المفاتيح:*\n` +
    `├ الإجمالي: ${s.totalKeys}\n` +
    `├ ✅ نشطة: ${s.active}\n` +
    `├ ⏰ منتهية: ${s.expired}\n` +
    `└ 🚫 ملغاة: ${s.revoked}\n\n` +
    `📦 *الطلبات:*\n` +
    `├ الإجمالي: ${s.totalOrders}\n` +
    `└ 💰 الإيرادات: $${s.totalRevenue}\n\n` +
    `📈 *حسب الباقة:*\n` +
    `├ أسبوعي: ${s.byPlan.weekly}\n` +
    `├ شهري: ${s.byPlan.monthly}\n` +
    `└ سنوي: ${s.byPlan.yearly}`;
  
  const opts = { parse_mode: 'Markdown', ...getMainMenu() };
  
  if (messageId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

// ==================== عرض المفاتيح ====================
async function showKeys(chatId, filter = 'all', messageId = null, page = 0) {
  const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري التحميل...');
  
  const result = await callScript('listKeys', { pass: ADMIN_PASSWORD });
  
  await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
  
  if (!result.success || !result.keys) {
    return bot.sendMessage(chatId, '❌ فشل في جلب المفاتيح', getMainMenu());
  }
  
  let keys = result.keys;
  
  if (filter !== 'all') {
    keys = keys.filter(k => String(k.status).trim() === filter);
  }
  
  if (keys.length === 0) {
    const text = `📭 لا توجد مفاتيح ${filter !== 'all' ? 'بهذه الحالة' : ''}`;
    const opts = messageId 
      ? { chat_id: chatId, message_id: messageId, ...getKeysMenu() }
      : { ...getKeysMenu() };
    
    if (messageId) {
      return bot.editMessageText(text, opts).catch(() => bot.sendMessage(chatId, text, getKeysMenu()));
    }
    return bot.sendMessage(chatId, text, getKeysMenu());
  }
  
  keys.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  const perPage = 5;
  const totalPages = Math.ceil(keys.length / perPage);
  const startIdx = page * perPage;
  const pageKeys = keys.slice(startIdx, startIdx + perPage);
  
  let text = `🔑 *المفاتيح ${filter !== 'all' ? `(${getStatusName(filter)})` : ''}*\n`;
  text += `📊 ${keys.length} مفتاح | صفحة ${page + 1}/${totalPages}\n\n`;
  
  for (let i = 0; i < pageKeys.length; i++) {
    const k = pageKeys[i];
    const status = getStatusEmoji(k.status);
    const plan = getPlanName(k.plan);
    const expiry = formatDate(k.expiresAt);
    
    text += `${status} *${i + 1 + startIdx}.* \`${k.key}\`\n`;
    text += `   💎 ${plan} | 📅 ${expiry}\n`;
    if (k.payerInfo) text += `   👤 ${truncate(k.payerInfo, 30)}\n`;
    text += `\n`;
  }
  
  const navButtons = [];
  if (page > 0) navButtons.push({ text: '⬅️ السابق', callback_data: `keys_${filter}_${page - 1}` });
  if (page < totalPages - 1) navButtons.push({ text: 'التالي ➡️', callback_data: `keys_${filter}_${page + 1}` });
  
  const keyboard = [];
  if (navButtons.length > 0) keyboard.push(navButtons);
  
  for (const k of pageKeys) {
    const status = String(k.status).trim();
    if (status === 'active') {
      keyboard.push([
        { text: `🚫 إلغاء ${k.key.substring(6, 18)}`, callback_data: `revoke_${k.key}` }
      ]);
    } else {
      keyboard.push([
        { text: `✅ تفعيل ${k.key.substring(6, 18)}`, callback_data: `activate_${k.key}` }
      ]);
    }
  }
  
  keyboard.push([{ text: '⬅️ رجوع للقائمة', callback_data: 'manage_keys' }]);
  
  const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  
  if (messageId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

// ==================== عرض الطلبات ====================
async function showOrders(chatId, page = 0, messageId = null) {
  const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري التحميل...');
  
  const result = await callScript('listKeys', { pass: ADMIN_PASSWORD });
  
  await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
  
  if (!result.success || !result.keys) {
    return bot.sendMessage(chatId, '❌ فشل في جلب الطلبات', getMainMenu());
  }
  
  const keys = result.keys.filter(k => k.payerInfo && k.payerInfo.trim());
  keys.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  if (keys.length === 0) {
    return bot.sendMessage(chatId, '📭 لا توجد طلبات', getMainMenu());
  }
  
  const perPage = 5;
  const totalPages = Math.ceil(keys.length / perPage);
  const startIdx = page * perPage;
  const pageKeys = keys.slice(startIdx, startIdx + perPage);
  
  let text = `📋 *أحدث الطلبات*\n`;
  text += `📊 ${keys.length} طلب | صفحة ${page + 1}/${totalPages}\n\n`;
  
  for (let i = 0; i < pageKeys.length; i++) {
    const k = pageKeys[i];
    const info = k.payerInfo.split('|').map(s => s.trim());
    const email = info[0] || 'غير محدد';
    const name = info[1] || 'غير محدد';
    
    text += `*${i + 1 + startIdx}.* 👤 ${name}\n`;
    text += `   📧 ${email}\n`;
    text += `   💎 ${getPlanName(k.plan)} | 🔑 \`${k.key}\`\n`;
    text += `   📅 ${formatDate(k.createdAt)}\n\n`;
  }
  
  const navButtons = [];
  if (page > 0) navButtons.push({ text: '⬅️ السابق', callback_data: `orders_${page - 1}` });
  if (page < totalPages - 1) navButtons.push({ text: 'التالي ➡️', callback_data: `orders_${page + 1}` });
  
  const keyboard = [];
  if (navButtons.length > 0) keyboard.push(navButtons);
  keyboard.push([{ text: '⬅️ رجوع', callback_data: 'main_menu' }]);
  
  const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  
  if (messageId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

// ==================== المشتركين النشطين ====================
async function showSubscribers(chatId, page = 0, messageId = null) {
  const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري التحميل...');
  
  const result = await callScript('listKeys', { pass: ADMIN_PASSWORD });
  
  await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
  
  if (!result.success || !result.keys) {
    return bot.sendMessage(chatId, '❌ فشل في جلب المشتركين', getMainMenu());
  }
  
  const now = new Date();
  const subscribers = result.keys.filter(k => {
    if (String(k.status).trim() !== 'active') return false;
    const expiry = new Date(k.expiresAt);
    return expiry > now;
  });
  
  subscribers.sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
  
  if (subscribers.length === 0) {
    return bot.sendMessage(chatId, '📭 لا يوجد مشتركون نشطون', getMainMenu());
  }
  
  const perPage = 5;
  const totalPages = Math.ceil(subscribers.length / perPage);
  const startIdx = page * perPage;
  const pageSubs = subscribers.slice(startIdx, startIdx + perPage);
  
  let text = `👥 *المشتركون النشطون*\n`;
  text += `📊 ${subscribers.length} مشترك | صفحة ${page + 1}/${totalPages}\n\n`;
  
  for (let i = 0; i < pageSubs.length; i++) {
    const k = pageSubs[i];
    const info = k.payerInfo ? k.payerInfo.split('|').map(s => s.trim()) : ['', ''];
    const daysLeft = Math.ceil((new Date(k.expiresAt) - now) / (1000 * 60 * 60 * 24));
    
    text += `*${i + 1 + startIdx}.* ${info[1] || info[0] || 'غير محدد'}\n`;
    text += `   🔑 \`${k.key}\`\n`;
    text += `   💎 ${getPlanName(k.plan)} | ⏰ ${daysLeft} يوم متبقي\n\n`;
  }
  
  const navButtons = [];
  if (page > 0) navButtons.push({ text: '⬅️ السابق', callback_data: `subs_${page - 1}` });
  if (page < totalPages - 1) navButtons.push({ text: 'التالي ➡️', callback_data: `subs_${page + 1}` });
  
  const keyboard = [];
  if (navButtons.length > 0) keyboard.push(navButtons);
  keyboard.push([{ text: '⬅️ رجوع', callback_data: 'main_menu' }]);
  
  const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } };
  
  if (messageId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts })
      .catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

// ==================== دوال مساعدة ====================
function getStatusEmoji(status) {
  status = String(status).trim();
  if (status === 'active') return '✅';
  if (status === 'expired') return '⏰';
  if (status === 'revoked') return '🚫';
  return '❓';
}

function getStatusName(status) {
  status = String(status).trim();
  if (status === 'active') return 'النشطة';
  if (status === 'expired') return 'المنتهية';
  if (status === 'revoked') return 'الملغاة';
  return 'الكل';
}

function getPlanName(plan) {
  plan = String(plan).trim();
  if (plan === 'weekly') return 'أسبوعي';
  if (plan === 'monthly') return 'شهري';
  if (plan === 'yearly') return 'سنوي';
  return plan;
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-DZ', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return 'غير معروف';
  }
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

// ==================== أوامر البوت ====================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'مستخدم';
  
  if (!isAdmin(chatId)) {
    return bot.sendMessage(chatId, 
      `🔒 *بوت DramaWorld الإداري*\n\n` +
      `مرحباً ${name}!\n` +
      `هذا البوت مخصص للمشرفين فقط.\n\n` +
      `للدخول، أرسل كلمة المرور:\n` +
      `/login كلمة_المرور`,
      { parse_mode: 'Markdown' }
    );
  }
  
  bot.sendMessage(chatId,
    `🎬 *مرحباً بك في بوت DramaWorld الإداري*\n\n` +
    `👤 ${name}\n` +
    `🆔 معرفك: \`${chatId}\`\n\n` +
    `اختر من القائمة أدناه:`,
    { parse_mode: 'Markdown', ...getMainMenu() }
  );
});

bot.onText(/\/login (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const password = match[1].trim();
  
  if (password === ADMIN_PASSWORD) {
    authorizedUsers.add(String(chatId));
    bot.sendMessage(chatId,
      `✅ *تم تسجيل الدخول بنجاح!*\n\nاختر من القائمة:`,
      { parse_mode: 'Markdown', ...getMainMenu() }
    );
  } else {
    bot.sendMessage(chatId, '❌ كلمة مرور خاطئة!');
  }
});

bot.onText(/\/stats/, (msg) => {
  if (!isAdmin(msg.chat.id)) return bot.sendMessage(msg.chat.id, '🔒 غير مصرح');
  showStats(msg.chat.id);
});

bot.onText(/\/keys/, (msg) => {
  if (!isAdmin(msg.chat.id)) return bot.sendMessage(msg.chat.id, '🔒 غير مصرح');
  showKeys(msg.chat.id, 'all');
});

bot.onText(/\/orders/, (msg) => {
  if (!isAdmin(msg.chat.id)) return bot.sendMessage(msg.chat.id, '🔒 غير مصرح');
  showOrders(msg.chat.id);
});

bot.onText(/\/subs/, (msg) => {
  if (!isAdmin(msg.chat.id)) return bot.sendMessage(msg.chat.id, '🔒 غير مصرح');
  showSubscribers(msg.chat.id);
});

// ==================== إنشاء مفتاح يدوي ====================
bot.onText(/\/newkey (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, '🔒 غير مصرح');
  
  const args = match[1].trim().split(/\s+/);
  const plan = args[0] || 'monthly';
  const note = args.slice(1).join(' ') || 'يدوي';
  
  const loadingMsg = await bot.sendMessage(chatId, '⏳ جاري إنشاء المفتاح...');
  
  const result = await callScript('saveOrder', {
    binanceId: `MANUAL_${note}`,
    phone: note,
    plan: plan,
    amount: plan === 'weekly' ? 0.99 : (plan === 'yearly' ? 30 : 3),
    paymentMethod: 'manual',
    paypalOrderId: `MANUAL_${Date.now()}`
  });
  
  await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
  
  if (result.success && result.key) {
    bot.sendMessage(chatId,
      `✅ *تم إنشاء المفتاح بنجاح!*\n\n` +
      `🔑 المفتاح: \`${result.key}\`\n` +
      `💎 الباقة: ${getPlanName(plan)}\n` +
      `📝 الملاحظة: ${note}\n` +
      `🆔 الطلب: \`${result.orderId}\`\n\n` +
      `💡 أرسل هذا المفتاح للعميل`,
      { parse_mode: 'Markdown', ...getMainMenu() }
    );
  } else {
    bot.sendMessage(chatId, '❌ فشل في إنشاء المفتاح', getMainMenu());
  }
});

// ==================== معالجة الأزرار ====================
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  
  if (!isAdmin(chatId)) {
    return bot.answerCallbackQuery(query.id, { text: '🔒 غير مصرح', show_alert: true });
  }
  
  await bot.answerCallbackQuery(query.id).catch(() => {});
  
  if (data === 'main_menu') {
    return bot.editMessageText(
      `🎬 *لوحة التحكم الرئيسية*\n\nاختر من القائمة:`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...getMainMenu() }
    ).catch(() => bot.sendMessage(chatId, '🎬 *لوحة التحكم*', { parse_mode: 'Markdown', ...getMainMenu() }));
  }
  
  if (data === 'stats') return showStats(chatId, messageId);
  
  if (data === 'manage_keys') {
    return bot.editMessageText(
      `🔑 *إدارة المفاتيح*\n\nاختر الفئة:`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...getKeysMenu() }
    ).catch(() => bot.sendMessage(chatId, '🔑 *إدارة المفاتيح*', { parse_mode: 'Markdown', ...getKeysMenu() }));
  }
  
  if (data === 'orders') return showOrders(chatId, 0, messageId);
  if (data === 'subscribers') return showSubscribers(chatId, 0, messageId);
  
  if (data === 'help') {
    return bot.editMessageText(
      `❓ *مساعدة*\n\n` +
      `*الأوامر المتاحة:*\n` +
      `/start - القائمة الرئيسية\n` +
      `/login كلمة_المرور - تسجيل الدخول\n` +
      `/stats - الإحصائيات\n` +
      `/keys - كل المفاتيح\n` +
      `/orders - الطلبات\n` +
      `/subs - المشتركين النشطين\n` +
      `/newkey الباقة ملاحظة - إنشاء مفتاح\n\n` +
      `*مثال:*\n` +
      `/newkey monthly عميل_جديد`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...getMainMenu() }
    );
  }
  
  if (data === 'search_key') {
    userStates.set(chatId, { action: 'search_key' });
    return bot.sendMessage(chatId, 
      `🔍 *البحث عن مفتاح*\n\nأرسل المفتاح للبحث عنه:`,
      { parse_mode: 'Markdown' }
    );
  }
  
  if (data === 'create_key') {
    return bot.sendMessage(chatId,
      `➕ *إنشاء مفتاح يدوي*\n\n` +
      `استخدم الأمر:\n` +
      `/newkey الباقة الملاحظة\n\n` +
      `*الباقات:* weekly / monthly / yearly\n\n` +
      `*مثال:*\n` +
      `/newkey monthly عميل_جديد`,
      { parse_mode: 'Markdown', ...getMainMenu() }
    );
  }
  
  if (data.startsWith('keys_')) {
    const parts = data.split('_');
    const filter = parts[1];
    const page = parseInt(parts[2]) || 0;
    return showKeys(chatId, filter, messageId, page);
  }
  
  if (data.startsWith('orders_')) {
    const page = parseInt(data.split('_')[1]);
    return showOrders(chatId, page, messageId);
  }
  
  if (data.startsWith('subs_')) {
    const page = parseInt(data.split('_')[1]);
    return showSubscribers(chatId, page, messageId);
  }
  
  if (data.startsWith('activate_')) {
    const key = data.substring(9);
    const loadingMsg = await bot.sendMessage(chatId, `⏳ جاري تفعيل المفتاح...`);
    
    const result = await callScript('activateKey', { pass: ADMIN_PASSWORD, key });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    
    if (result.success) {
      bot.sendMessage(chatId, `✅ *تم تفعيل المفتاح بنجاح!*\n\n🔑 \`${key}\``, 
        { parse_mode: 'Markdown', ...getMainMenu() });
    } else {
      bot.sendMessage(chatId, `❌ فشل في التفعيل\nتأكد من صحة المفتاح`, getMainMenu());
    }
    return;
  }
  
  if (data.startsWith('revoke_')) {
    const key = data.substring(7);
    return bot.sendMessage(chatId,
      `⚠️ *تأكيد الإلغاء*\n\nهل أنت متأكد من إلغاء المفتاح:\n\`${key}\`؟`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ نعم، ألغِ', callback_data: `confirm_revoke_${key}` },
              { text: '❌ لا', callback_data: 'manage_keys' }
            ]
          ]
        }
      }
    );
  }
  
  if (data.startsWith('confirm_revoke_')) {
    const key = data.substring(15);
    const loadingMsg = await bot.sendMessage(chatId, `⏳ جاري الإلغاء...`);
    
    const result = await callScript('revokeKey', { pass: ADMIN_PASSWORD, key });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    
    if (result.success) {
      bot.sendMessage(chatId, `🚫 *تم إلغاء المفتاح*\n\n🔑 \`${key}\``, 
        { parse_mode: 'Markdown', ...getMainMenu() });
    } else {
      bot.sendMessage(chatId, `❌ فشل الإلغاء`, getMainMenu());
    }
    return;
  }
});

// ==================== معالجة الرسائل النصية ====================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  if (!text || text.startsWith('/')) return;
  if (!isAdmin(chatId)) return;
  
  const state = userStates.get(chatId);
  
  if (state && state.action === 'search_key') {
    userStates.delete(chatId);
    
    const loadingMsg = await bot.sendMessage(chatId, '🔍 جاري البحث...');
    
    const result = await callScript('listKeys', { pass: ADMIN_PASSWORD });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    
    if (!result.success || !result.keys) {
      return bot.sendMessage(chatId, '❌ فشل في البحث', getMainMenu());
    }
    
    const found = result.keys.find(k => String(k.key).trim() === text.trim());
    
    if (found) {
      const daysLeft = Math.ceil((new Date(found.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
      
      let infoText = 
        `🔍 *نتيجة البحث*\n\n` +
        `🔑 المفتاح: \`${found.key}\`\n` +
        `${getStatusEmoji(found.status)} الحالة: ${getStatusName(found.status)}\n` +
        `💎 الباقة: ${getPlanName(found.plan)}\n` +
        `📅 تاريخ الإنشاء: ${formatDate(found.createdAt)}\n` +
        `⏰ تاريخ الانتهاء: ${formatDate(found.expiresAt)}\n`;
      
      if (String(found.status).trim() === 'active') {
        infoText += `⏳ الأيام المتبقية: ${daysLeft} يوم\n`;
      }
      
      if (found.payerInfo) {
        infoText += `👤 معلومات الدافع: ${found.payerInfo}\n`;
      }
      
      const status = String(found.status).trim();
      const keyboard = [];
      
      if (status === 'active') {
        keyboard.push([{ text: '🚫 إلغاء التفعيل', callback_data: `revoke_${found.key}` }]);
      } else {
        keyboard.push([{ text: '✅ تفعيل', callback_data: `activate_${found.key}` }]);
      }
      
      keyboard.push([{ text: '⬅️ رجوع', callback_data: 'main_menu' }]);
      
      return bot.sendMessage(chatId, infoText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } else {
      return bot.sendMessage(chatId, `❌ لم يتم العثور على المفتاح:\n\`${text}\``, 
        { parse_mode: 'Markdown', ...getMainMenu() });
    }
  }
});

// ==================== معالجة الأخطاء ====================
bot.on('polling_error', (error) => {
  console.error('Polling Error:', error.message);
});

bot.on('webhook_error', (error) => {
  console.error('Webhook Error:', error.message);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

console.log('🤖 بوت DramaWorld يعمل...');
console.log(`📡 متصل بـ: ${SCRIPT_URL}`);
console.log(`🌐 الوضع: ${RENDER_URL ? 'Webhook (Render)' : 'Polling (محلي)'}`);
