require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const Groq    = require('groq-sdk');

const app  = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.json());

// ── МИД chatbot-ын system prompt ────────────────────────────
const SYSTEM = `Та "МИД Туслагч" — Монгол Улсын Малын индексжүүлсэн даатгал (МИД)-ын
мэргэжлийн туслагч chatbot. Зөвхөн монгол хэлээр, богино ойлгомжтой хариулт өгнө.

## Үндсэн мэдлэг
- МИД: 2006 онд Дэлхийн банктай хамтран эхэлсэн, зудаас малчдыг хамгаалах даатгал
- Сумын НИЙТ малын хорогдлоор нөхөн төлбөр тодорхойлно (хувийн хотонд биш)
- Таван хошуу мал даатгуулах боломжтой
- Бүртгүүлэх хугацаа: 1/1 – 8/31 (Хаан, Төрийн банк), 3/1 – 6/30 (даатгалын компани)
- Босго: 120 суманд 4%, 155 суманд 5% (2026–2028)
- 2024 онд 16.8 тэрбум төгрөгийн нөхөн төлбөр олгосон
- Компаниуд: Ард, Бодь, МИГ, Монгол, Мөнх, Практикал, Хаан даатгал
- Нөхөн төлбөрийн томьёо: малын тоо × нэгж үнэ × (хорогдлын % − босго %)
- Доод нөхөн төлбөр: төлсөн хураамжийн 35% эсвэл 100,000₮-н аль их нь`;

// ── Хэрэглэгч бүрийн харилцааны түүх ───────────────────────
const sessions = {};

function getHistory(id) {
  if (!sessions[id]) sessions[id] = [];
  return sessions[id];
}

// ── 1. Webhook баталгаажуулалт ───────────────────────────────
app.get('/webhook', (req, res) => {
  if (
    req.query['hub.mode']         === 'subscribe' &&
    req.query['hub.verify_token'] === process.env.VERIFY_TOKEN
  ) {
    console.log('✅ Webhook баталгаажлаа');
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

// ── 2. Мессеж хүлээн авах ────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  if (body.object !== 'page') return;

  for (const entry of body.entry) {
    const event = entry.messaging?.[0];
    if (!event?.message?.text) continue;

    const senderId = event.sender.id;
    const userText = event.message.text;

    await typingOn(senderId);

    const hist = getHistory(senderId);
    hist.push({ role: 'user', content: userText });
    if (hist.length > 20) hist.splice(0, 2);

    try {
      const response = await groq.chat.completions.create({
        model       : 'llama-3.3-70b-versatile',
        max_tokens  : 500,
        messages    : [
          { role: 'system', content: SYSTEM },
          ...hist
        ],
      });

      const reply = response.choices[0].message.content;
      hist.push({ role: 'assistant', content: reply });

      await typingOff(senderId);
      await sendMessage(senderId, reply);

    } catch (err) {
      console.error('Groq алдаа:', err.message);
      await typingOff(senderId);
      await sendMessage(senderId, 'Уучлаарай, түр саатал гарлаа. Дахин оролдоно уу.');
    }
  }
});

// ── Туслах функцүүд ──────────────────────────────────────────
async function sendMessage(recipientId, text) {
  const chunks = text.match(/.{1,1900}(\s|$)/gs) || [text];
  for (const chunk of chunks) {
    await axios.post(
      'https://graph.facebook.com/v19.0/me/messages',
      { recipient: { id: recipientId }, message: { text: chunk.trim() } },
      { params: { access_token: process.env.FB_PAGE_TOKEN } }
    );
  }
}

async function typingOn(recipientId) {
  await axios.post(
    'https://graph.facebook.com/v19.0/me/messages',
    { recipient: { id: recipientId }, sender_action: 'typing_on' },
    { params: { access_token: process.env.FB_PAGE_TOKEN } }
  ).catch(() => {});
}

async function typingOff(recipientId) {
  await axios.post(
    'https://graph.facebook.com/v19.0/me/messages',
    { recipient: { id: recipientId }, sender_action: 'typing_off' },
    { params: { access_token: process.env.FB_PAGE_TOKEN } }
  ).catch(() => {});
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер ${PORT}-р портод ажиллаж байна`));