import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const PANEL_URL = process.env.PANEL_URL || "";
const DATA_DIR = path.join(__dirname, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 12000, maxRetries: 0 })
  : null;

const DEFAULT_SETTINGS = {
  color: "#168bff",
  brightness: 75,
  voice: "default",
  theme: "dark"
};

let settingsStore = {};

async function loadSettings() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    settingsStore = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf8"));
  } catch {
    settingsStore = {};
  }
}

async function persistSettings() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = SETTINGS_FILE + ".tmp";
  await fs.writeFile(temp, JSON.stringify(settingsStore, null, 2), "utf8");
  await fs.rename(temp, SETTINGS_FILE);
}

function getSettings(userId) {
  return { ...DEFAULT_SETTINGS, ...(settingsStore[userId] || {}) };
}

async function saveSettings(userId, next) {
  settingsStore[userId] = { ...DEFAULT_SETTINGS, ...next };
  await persistSettings();
  return getSettings(userId);
}

async function askAI(question) {
  if (!openai) {
    return "ИИ пока не подключён. Добавьте OPENAI_API_KEY в файл .env и перезапустите сервер.";
  }
  try {
    const result = await openai.responses.create({
      model: MODEL,
      instructions: [
        "Ты MY ALICE — самостоятельный дружелюбный голосовой помощник.",
        "Отвечай на русском языке, ясно и естественно.",
        "Для голосового ответа предпочитай короткие ответы.",
        "Не утверждай, что управляешь устройствами или выполняешь действия,",
        "если соответствующий инструмент действительно не подключён."
      ].join(" "),
      input: question,
      max_output_tokens: 300
    });
    return result.output_text?.trim() || "Не получилось сформировать ответ. Попробуй ещё раз.";
  } catch (error) {
    console.error("OpenAI error:", error.message);
    return "Сейчас не удалось связаться с ИИ. Проверь подключение и попробуй ещё раз.";
  }
}

function getYandexUserId(session) {
  // Для навыка используем стабильный user_id Яндекса, если он доступен.
  return session?.user?.user_id
    || session?.application?.application_id
    || session?.session_id
    || "guest";
}

function yandexReply(text, session, buttons = [], endSession = false) {
  const response = {
    version: "1.0",
    session,
    response: {
      text: String(text).slice(0, 1024),
      end_session: endSession
    }
  };
  if (buttons.length) response.response.buttons = buttons;
  return response;
}

const COLORS = {
  "синий": "#168bff",
  "голубой": "#00d9ff",
  "фиолетовый": "#a020f0",
  "красный": "#ff3030",
  "зелёный": "#00d878",
  "зеленый": "#00d878",
  "розовый": "#ff69b4",
  "жёлтый": "#ffd700",
  "желтый": "#ffd700",
  "белый": "#ffffff"
};

const VOICES = {
  "обычный": "default",
  "женский": "female",
  "мужской": "male",
  "первый": "voice1",
  "второй": "voice2",
  "третий": "voice3"
};

app.post("/alice", async (req, res) => {
  const body = req.body || {};
  const session = body.session || {};
  const request = body.request || {};
  const userId = getYandexUserId(session);
  const settings = getSettings(userId);
  const command = String(request.command || request.original_utterance || "")
    .trim().toLowerCase();

  try {
    if (session.new) {
      return res.json(yandexReply(
        "Привет! Я MY ALICE. Я могу общаться с помощью ИИ и менять настройки собственного интерфейса. Скажи «настройки» или задай вопрос.",
        session,
        PANEL_URL ? [{ title: "Открыть панель MY ALICE", url: PANEL_URL, hide: true }] : []
      ));
    }

    if (!command) {
      return res.json(yandexReply("Я не расслышала команду. Повтори, пожалуйста.", session));
    }

    if (command.includes("настройки") || command === "меню") {
      const buttons = [
        { title: "Синий индикатор", hide: true },
        { title: "Фиолетовый индикатор", hide: true },
        { title: "Женский голос", hide: true },
        { title: "Мужской голос", hide: true }
      ];
      if (PANEL_URL) buttons.push({ title: "Открыть панель", url: PANEL_URL, hide: true });
      return res.json(yandexReply(
        "Настройки MY ALICE. Скажи цвет индикатора, например «фиолетовый индикатор», или выбери голос: женский, мужской либо обычный. Точную настройку цветов и браузерных голосов можно сделать в веб-панели.",
        session, buttons
      ));
    }

    for (const [name, hex] of Object.entries(COLORS)) {
      if (command.includes(name) && /(индикатор|цвет|подсветк)/.test(command)) {
        const updated = await saveSettings(userId, { ...settings, color: hex });
        return res.json(yandexReply(
          `Для твоего интерфейса MY ALICE сохранён ${name} цвет индикатора.`,
          session,
          PANEL_URL ? [{ title: "Открыть панель", url: PANEL_URL, hide: true }] : []
        ));
      }
    }

    for (const [name, voice] of Object.entries(VOICES)) {
      if (command.includes(name) && command.includes("голос")) {
        await saveSettings(userId, { ...settings, voice });
        return res.json(yandexReply(
          `Сохранено предпочтение: ${name} голос. В веб-панели можно выбрать конкретный голос, доступный браузеру. Системный голос Алисы эта настройка не меняет.`,
          session,
          PANEL_URL ? [{ title: "Выбрать голос в панели", url: PANEL_URL, hide: true }] : []
        ));
      }
    }

    const brightnessMatch = command.match(/(?:яркость|ярче)\s*(\d{1,3})/);
    if (brightnessMatch) {
      const brightness = Math.max(10, Math.min(100, Number(brightnessMatch[1])));
      await saveSettings(userId, { ...settings, brightness });
      return res.json(yandexReply(`Яркость индикатора в панели установлена на ${brightness} процентов.`, session));
    }

    if (command.includes("светлая тема")) {
      await saveSettings(userId, { ...settings, theme: "light" });
      return res.json(yandexReply("Светлая тема сохранена для панели MY ALICE.", session));
    }
    if (command.includes("тёмная тема") || command.includes("темная тема")) {
      await saveSettings(userId, { ...settings, theme: "dark" });
      return res.json(yandexReply("Тёмная тема сохранена для панели MY ALICE.", session));
    }

    if (command.includes("что ты умеешь") || command === "помощь") {
      return res.json(yandexReply(
        "Я отвечаю на вопросы с помощью ИИ, а также сохраняю настройки цвета индикатора, яркости, темы и предпочтительного голоса. Физическую подсветку колонки и системный голос Алисы я менять не могу.",
        session
      ));
    }

    if (["пока", "выход", "завершить"].includes(command)) {
      return res.json(yandexReply("До встречи! Это был MY ALICE.", session, [], true));
    }

    const answer = await askAI(command);
    return res.json(yandexReply(answer, session));
  } catch (error) {
    console.error("Yandex webhook error:", error);
    return res.json(yandexReply("Произошла внутренняя ошибка. Попробуй ещё раз.", session));
  }
});

// Панель: вопросы к ИИ. Для публичного развёртывания добавьте авторизацию и лимиты.
app.post("/api/chat", async (req, res) => {
  const question = String(req.body?.question || "").trim();
  if (!question) return res.status(400).json({ answer: "Напиши вопрос." });
  if (question.length > 2000) {
    return res.status(413).json({ answer: "Сообщение слишком длинное (максимум 2000 символов)." });
  }
  res.json({ answer: await askAI(question) });
});

// Панель настроек хранится в браузере. Эти endpoints нужны для обмена настройками с сервером.
// Для публичного многопользовательского использования добавьте авторизацию.
app.get("/api/settings", (req, res) => {
  const userId = String(req.query.userId || "panel-guest").slice(0, 128);
  res.json(getSettings(userId));
});

app.put("/api/settings", async (req, res) => {
  const userId = String(req.body?.userId || "panel-guest").slice(0, 128);
  const input = req.body?.settings || {};
  const allowedColors = new Set(Object.values(COLORS));
  const color = allowedColors.has(input.color) ? input.color : DEFAULT_SETTINGS.color;
  const brightness = Math.max(10, Math.min(100, Number(input.brightness) || 75));
  const voice = ["default", "female", "male", "voice1", "voice2", "voice3"].includes(input.voice)
    ? input.voice : "default";
  const theme = input.theme === "light" ? "light" : "dark";
  const saved = await saveSettings(userId, { color, brightness, voice, theme });
  res.json(saved);
});

app.get("/health", (_req, res) => res.json({ status: "ok", name: "MY ALICE" }));

await loadSettings();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`MY ALICE is running on http://localhost:${PORT}`);
});
