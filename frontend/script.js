"use strict";

const GAME_SECONDS = 60;
const COUNTDOWN_SECONDS = 3;
const TARGET_SIZE = 60;
const NICKNAME_KEY = "aimrabs-nickname-v1";

const $ = (id) => document.getElementById(id);
const board = $("board");
const target = $("target");
const startScreen = $("start-screen");
const countdownEl = $("countdown");
const resultScreen = $("result-screen");
const nicknameInput = $("nickname");
const startErrorEl = $("start-error");
const timeEl = $("time");
const scoreEl = $("score");
const resultTitleEl = $("result-title");
const finalScoreEl = $("final-score");
const myRankEl = $("my-rank");
const leaderboardEl = $("leaderboard");
const resultStatusEl = $("result-status");
const retryButton = $("retry-button");
const retrySaveButton = $("retry-save-button");
const changeNameButton = $("change-name-button");
const refreshRankingButton = $("refresh-ranking-button");
const viewRankingButton = $("view-ranking-button");

let phase = "ready"; // ready, countdown, connecting, playing, finished, ranking
let nickname = "";
let score = 0;
let sessionId = null;
let gameDeadline = 0;
let frameId = 0;
let savedResult = null;
let submitting = false;

const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

// Convenience-only data. Scores and rankings NEVER use localStorage.
try {
  nicknameInput.value = localStorage.getItem(NICKNAME_KEY) || "";
} catch {
  // Private browsing or storage restrictions must not block the game.
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.detail === "string"
      ? data.detail : `서버 오류 (${response.status})`);
  }
  return data;
}

function showStartError(message) {
  startErrorEl.textContent = message;
  show(startErrorEl);
}

function resetStartScreen() {
  cancelAnimationFrame(frameId);
  phase = "ready";
  hide(resultScreen);
  hide(countdownEl);
  hide(target);
  show(startScreen);
  scoreEl.textContent = "0";
  timeEl.textContent = GAME_SECONDS.toFixed(1);
  nicknameInput.focus();
}

function startGame() {
  if (phase !== "ready" && phase !== "finished") return;
  cancelAnimationFrame(frameId);
  phase = "countdown";
  sessionId = null;
  savedResult = null;
  score = 0;
  scoreEl.textContent = "0";
  timeEl.textContent = GAME_SECONDS.toFixed(1);
  hide(startErrorEl);
  hide(resultScreen);
  hide(startScreen);
  hide(target);
  show(countdownEl);

  const deadline = performance.now() + COUNTDOWN_SECONDS * 1000;
  function tick() {
    if (phase !== "countdown") return;
    const remaining = Math.ceil((deadline - performance.now()) / 1000);
    if (remaining <= 0) {
      void beginPlaying();
      return;
    }
    countdownEl.textContent = String(remaining);
    frameId = requestAnimationFrame(tick);
  }
  tick();
}

async function beginPlaying() {
  phase = "connecting";
  countdownEl.textContent = "연결 중...";
  countdownEl.classList.add("connecting");
  try {
    // Start the server session AFTER the 3-2-1 countdown.
    const data = await api("/api/games/start", {
      method: "POST",
      body: JSON.stringify({ nickname }),
    });
    if (phase !== "connecting") return;
    sessionId = data.session_id;
    phase = "playing";
    countdownEl.classList.remove("connecting");
    hide(countdownEl);
    gameDeadline = performance.now() + GAME_SECONDS * 1000;
    moveTarget();
    show(target);
    updateTimer();
  } catch (error) {
    countdownEl.classList.remove("connecting");
    resetStartScreen();
    showStartError(`게임 시작 실패: ${error.message}`);
  }
}

function moveTarget() {
  const padding = 12;
  const maxX = Math.max(0, board.clientWidth - TARGET_SIZE - padding * 2);
  const maxY = Math.max(0, board.clientHeight - TARGET_SIZE - padding * 2);
  target.style.left = `${padding + Math.random() * maxX}px`;
  target.style.top = `${padding + Math.random() * maxY}px`;
}

function updateTimer() {
  if (phase !== "playing") return;
  const remaining = Math.max(0, (gameDeadline - performance.now()) / 1000);
  timeEl.textContent = remaining.toFixed(1);
  if (remaining <= 0) {
    finishGame();
    return;
  }
  frameId = requestAnimationFrame(updateTimer);
}

function hitTarget() {
  if (phase !== "playing") return;
  if (performance.now() >= gameDeadline) {
    finishGame();
    return;
  }
  score += 1;
  scoreEl.textContent = String(score);
  moveTarget();
}

function displayResults(showFinalScore) {
  hide(startScreen);
  hide(countdownEl);
  hide(target);
  show(resultScreen);
  resultStatusEl.textContent = "";
  if (showFinalScore) {
    resultTitleEl.textContent = "GAME OVER";
    show(finalScoreEl);
    show(myRankEl);
    show(retryButton);
    changeNameButton.textContent = "닉네임 변경";
  } else {
    resultTitleEl.textContent = "LEADERBOARD";
    hide(finalScoreEl);
    hide(myRankEl);
    hide(retryButton);
    changeNameButton.textContent = "뒤로";
  }
  hide(retrySaveButton);
}

function renderLeaderboard(items) {
  leaderboardEl.replaceChildren();
  if (!Array.isArray(items) || items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "아직 등록된 기록이 없습니다.";
    leaderboardEl.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.rank}위 · ${item.nickname} — ${item.score}점`;
    if (item.session_id === sessionId) li.classList.add("mine");
    leaderboardEl.appendChild(li);
  });
}

async function refreshRanking() {
  const data = await api("/api/leaderboard");
  renderLeaderboard(data.items);
}

async function saveResult() {
  if (!sessionId || submitting) return;
  submitting = true;
  retrySaveButton.disabled = true;
  hide(retrySaveButton);
  resultStatusEl.textContent = "기록 저장 중...";
  retryButton.disabled = true;
  try {
    // Repeating the same finish payload is safe (idempotent on the server).
    savedResult = await api(`/api/games/${sessionId}/finish`, {
      method: "POST",
      body: JSON.stringify({ score }),
    });
  } catch (error) {
    // If a response was lost after a successful save, recover the saved record.
    try {
      const existing = await api(`/api/games/${sessionId}/result`);
      if (existing.score !== score) throw new Error("저장 점수가 일치하지 않습니다.");
      savedResult = existing;
    } catch {
      resultStatusEl.textContent = `저장 실패: ${error.message}`;
      show(retrySaveButton);
      retrySaveButton.disabled = false;
      submitting = false;
      retryButton.disabled = false;
      return;
    }
  }

  myRankEl.textContent = `내 순위: ${savedResult.rank}위`;
  resultStatusEl.textContent = "기록이 서버에 저장되었습니다.";
  try {
    await refreshRanking();
  } catch (error) {
    resultStatusEl.textContent = `저장 완료 · 랭킹 조회 실패: ${error.message}`;
  }
  submitting = false;
  retrySaveButton.disabled = false;
  retryButton.disabled = false;
}

function finishGame() {
  if (phase !== "playing") return;
  phase = "finished";
  cancelAnimationFrame(frameId);
  timeEl.textContent = "0.0";
  displayResults(true);
  finalScoreEl.textContent = `${score}점`;
  myRankEl.textContent = "내 순위 계산 중...";
  void saveResult();
}

startScreen.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = nicknameInput.value.trim();
  if (value.length < 1 || value.length > 16) {
    showStartError("닉네임은 1~16자로 입력하세요.");
    return;
  }
  nickname = value;
  nicknameInput.value = value;
  try { localStorage.setItem(NICKNAME_KEY, value); } catch { /* optional */ }
  startGame();
});

nicknameInput.addEventListener("input", () => hide(startErrorEl));
target.addEventListener("click", hitTarget);
retryButton.addEventListener("click", startGame);
retrySaveButton.addEventListener("click", () => void saveResult());
refreshRankingButton.addEventListener("click", async () => {
  resultStatusEl.textContent = "랭킹 조회 중...";
  try {
    await refreshRanking();
    resultStatusEl.textContent = savedResult
      ? "기록이 서버에 저장되었습니다." : "최신 랭킹입니다.";
  } catch (error) {
    resultStatusEl.textContent = `랭킹 조회 실패: ${error.message}`;
  }
});

viewRankingButton.addEventListener("click", async () => {
  if (phase !== "ready") return;
  phase = "ranking";
  displayResults(false);
  resultStatusEl.textContent = "랭킹 조회 중...";
  try {
    await refreshRanking();
    resultStatusEl.textContent = "최신 랭킹입니다.";
  } catch (error) {
    resultStatusEl.textContent = `랭킹 조회 실패: ${error.message}`;
  }
});

changeNameButton.addEventListener("click", resetStartScreen);
window.addEventListener("resize", () => {
  if (phase === "playing") moveTarget();
});
