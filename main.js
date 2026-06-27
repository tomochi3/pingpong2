(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const FIELD_W = 1280;
  const FIELD_H = 720;
  const SCORE_TO_WIN = 7;
  const PLAYER_MAX_SPEED = 900;
  const PLAYER_ACCEL = 1850;
  const PLAYER_BRAKE = 2300;
  const AI_MAX_SPEED = 780;
  const AI_ACCEL = 1500;
  const AI_BRAKE = 1900;
  const PADDLE_W = 20;
  const PADDLE_H = 116;
  const BALL_R = 11;
  const SPIN_SCORE_MAX = 1.6;
  const SPIN_CURVE_ACCEL = 560;
  const SPIN_DECAY = 0.88;
  const MAX_BALL_VY = 660;
  const MAX_SPIN_PADDLE_SPEED = PLAYER_MAX_SPEED;
  const STRONG_SPIN_SOUND_THRESHOLD = 0.8;
  const keys = new Set();

  let lastTime = 0;
  let rafId = 0;
  let dpr = 1;
  let pointerY = null;
  let audioContext = null;

  const state = {
    mode: "menu",
    pointTimer: 0,
    lastPoint: null,
    lastPointAmount: 0,
    lastScoreReason: null,
    winner: null,
    rally: 0,
    spinNotice: {
      timer: 0,
      amount: 0,
      side: null,
      x: FIELD_W / 2,
      y: FIELD_H / 2,
    },
    audio: {
      available: false,
      unlocked: false,
      eventCount: 0,
      lastCue: null,
      lastSpinAmount: 0,
      lastCueStrong: false,
    },
    player: {
      x: 66,
      y: FIELD_H / 2 - PADDLE_H / 2,
      w: PADDLE_W,
      h: PADDLE_H,
      score: 0,
      vy: 0,
    },
    opponent: {
      x: FIELD_W - 66 - PADDLE_W,
      y: FIELD_H / 2 - PADDLE_H / 2,
      w: PADDLE_W,
      h: PADDLE_H,
      score: 0,
      vy: 0,
    },
    ball: {
      x: FIELD_W / 2,
      y: FIELD_H / 2,
      r: BALL_R,
      vx: 420,
      vy: 120,
      speed: 440,
      spin: 0,
    },
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function randSign() {
    return Math.random() < 0.5 ? -1 : 1;
  }

  function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function formatScore(value) {
    return round2(value).toFixed(2);
  }

  function approach(value, target, amount) {
    if (value < target) return Math.min(value + amount, target);
    if (value > target) return Math.max(value - amount, target);
    return target;
  }

  function getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      state.audio.available = false;
      return null;
    }

    state.audio.available = true;
    if (!audioContext) {
      audioContext = new AudioContextClass();
    }
    return audioContext;
  }

  function resumeAudio() {
    const audio = getAudioContext();
    if (!audio) return;

    state.audio.unlocked = true;
    if (audio.state === "suspended") {
      audio.resume().catch(() => {});
    }
  }

  function rememberSound(cue, spinAmount = 0, strong = false) {
    state.audio.eventCount += 1;
    state.audio.lastCue = cue;
    state.audio.lastSpinAmount = round2(spinAmount);
    state.audio.lastCueStrong = strong;
  }

  function playTone({ type = "sine", frequency, endFrequency, duration, gain, delay = 0, pan = 0 }) {
    const audio = getAudioContext();
    if (!audio || audio.state === "suspended") return;

    const start = audio.currentTime + delay;
    const end = start + duration;
    const oscillator = audio.createOscillator();
    const gainNode = audio.createGain();
    const panner = audio.createStereoPanner ? audio.createStereoPanner() : null;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), end);
    }

    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gainNode);
    if (panner) {
      panner.pan.setValueAtTime(pan, start);
      gainNode.connect(panner);
      panner.connect(audio.destination);
    } else {
      gainNode.connect(audio.destination);
    }

    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }

  function playNoise({ duration, gain, delay = 0, pan = 0 }) {
    const audio = getAudioContext();
    if (!audio || audio.state === "suspended") return;

    const sampleCount = Math.max(1, Math.floor(audio.sampleRate * duration));
    const buffer = audio.createBuffer(1, sampleCount, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / sampleCount);
    }

    const start = audio.currentTime + delay;
    const source = audio.createBufferSource();
    const gainNode = audio.createGain();
    const filter = audio.createBiquadFilter();
    const panner = audio.createStereoPanner ? audio.createStereoPanner() : null;

    source.buffer = buffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(900, start);
    gainNode.gain.setValueAtTime(gain, start);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(gainNode);
    if (panner) {
      panner.pan.setValueAtTime(pan, start);
      gainNode.connect(panner);
      panner.connect(audio.destination);
    } else {
      gainNode.connect(audio.destination);
    }

    source.start(start);
    source.stop(start + duration + 0.02);
  }

  function playPaddleSound(side, spinAmount, spinDirection) {
    const strong = spinAmount >= STRONG_SPIN_SOUND_THRESHOLD;
    const pan = side === "player" ? -0.45 : 0.45;

    rememberSound(strong ? "strong-spin-hit" : "paddle-hit", spinAmount, strong);

    if (strong) {
      const pitch = 470 + spinAmount * 110;
      playTone({ type: "sawtooth", frequency: pitch, endFrequency: pitch * 1.85, duration: 0.17, gain: 0.075, pan });
      playTone({
        type: "triangle",
        frequency: pitch * (spinDirection >= 0 ? 1.45 : 1.18),
        endFrequency: pitch * (spinDirection >= 0 ? 2.4 : 0.72),
        duration: 0.24,
        gain: 0.045,
        delay: 0.025,
        pan,
      });
      playNoise({ duration: 0.12, gain: 0.035, delay: 0.012, pan });
      return;
    }

    const pitch = 230 + spinAmount * 130;
    playTone({ type: "square", frequency: pitch, endFrequency: pitch * 0.72, duration: 0.075, gain: 0.05, pan });
    playTone({ type: "sine", frequency: pitch * 1.8, endFrequency: pitch * 1.15, duration: 0.06, gain: 0.025, delay: 0.008, pan });
  }

  function playPointSound(side) {
    const pan = side === "player" ? -0.2 : 0.2;
    rememberSound("point", 0, false);
    playTone({ type: "triangle", frequency: side === "player" ? 520 : 330, endFrequency: side === "player" ? 780 : 250, duration: 0.2, gain: 0.055, pan });
    playTone({ type: "sine", frequency: side === "player" ? 780 : 220, endFrequency: side === "player" ? 1040 : 180, duration: 0.18, gain: 0.03, delay: 0.08, pan });
  }

  function resetScores() {
    state.player.score = 0;
    state.opponent.score = 0;
    state.winner = null;
    state.lastPoint = null;
    state.lastPointAmount = 0;
    state.lastScoreReason = null;
    state.rally = 0;
    state.spinNotice.timer = 0;
  }

  function resetBall(direction = randSign()) {
    const angle = (Math.random() * 0.62 - 0.31);
    const speed = 440;
    state.ball.x = FIELD_W / 2;
    state.ball.y = FIELD_H / 2;
    state.ball.speed = speed;
    state.ball.vx = Math.cos(angle) * speed * direction;
    state.ball.vy = Math.sin(angle) * speed;
    state.ball.spin = 0;
  }

  function resetPaddles() {
    state.player.y = FIELD_H / 2 - state.player.h / 2;
    state.opponent.y = FIELD_H / 2 - state.opponent.h / 2;
    state.player.vy = 0;
    state.opponent.vy = 0;
    pointerY = null;
  }

  function startGame() {
    resetScores();
    resetPaddles();
    resetBall(randSign());
    state.mode = "playing";
  }

  function addScore(side, amount) {
    const target = side === "player" ? state.player : state.opponent;
    target.score = round2(target.score + amount);
    state.lastPoint = side;
    state.lastPointAmount = amount;
  }

  function checkWinner() {
    if (state.player.score < SCORE_TO_WIN && state.opponent.score < SCORE_TO_WIN) {
      return false;
    }

    state.mode = "gameover";
    state.winner = state.player.score > state.opponent.score ? "player" : "opponent";
    resetBall(state.winner === "player" ? -1 : 1);
    return true;
  }

  function awardPoint(side) {
    addScore(side, 1);
    state.lastScoreReason = "miss";
    playPointSound(side);

    state.rally = 0;

    if (checkWinner()) {
      return;
    }

    state.mode = "point";
    state.pointTimer = 0.9;
    resetBall(side === "player" ? -1 : 1);
  }

  function awardSpinScore(side, amount, x, y) {
    if (amount <= 0) return false;

    addScore(side, amount);
    state.lastScoreReason = "spin";
    state.spinNotice = {
      timer: 0.9,
      amount,
      side,
      x,
      y: clamp(y - 36, 76, FIELD_H - 76),
    };

    return checkWinner();
  }

  function rectCenterY(rect) {
    return rect.y + rect.h / 2;
  }

  function ballHitsPaddle(paddle) {
    const ball = state.ball;
    return (
      ball.x + ball.r >= paddle.x &&
      ball.x - ball.r <= paddle.x + paddle.w &&
      ball.y + ball.r >= paddle.y &&
      ball.y - ball.r <= paddle.y + paddle.h
    );
  }

  function bounceFromPaddle(paddle, direction) {
    const ball = state.ball;
    const offset = clamp((ball.y - rectCenterY(paddle)) / (paddle.h / 2), -1, 1);
    const speed = Math.min(ball.speed + 24, 760);
    const angle = offset * 0.88;
    const side = direction > 0 ? "player" : "opponent";
    const spinPower = clamp(paddle.vy / MAX_SPIN_PADDLE_SPEED, -1, 1);
    const spinAmount = round2(Math.abs(spinPower) * SPIN_SCORE_MAX);

    ball.speed = speed;
    ball.vx = Math.cos(angle) * speed * direction;
    ball.vy = clamp(Math.sin(angle) * speed + paddle.vy * 0.12, -MAX_BALL_VY, MAX_BALL_VY);
    ball.spin = clamp(spinPower + offset * 0.18, -1.25, 1.25);
    ball.x = direction > 0 ? paddle.x + paddle.w + ball.r : paddle.x - ball.r;
    state.rally += 1;

    playPaddleSound(side, spinAmount, spinPower);
    awardSpinScore(side, spinAmount, ball.x, ball.y);
  }

  function updatePaddleVelocity(current, intent, accel, brake, maxSpeed, dt) {
    if (intent !== 0) {
      return clamp(current + intent * accel * dt, -maxSpeed, maxSpeed);
    }

    return approach(current, 0, brake * dt);
  }

  function keepPaddleInBounds(paddle) {
    const nextY = clamp(paddle.y, 34, FIELD_H - paddle.h - 34);
    if (nextY !== paddle.y) {
      const pushingOut =
        (nextY === 34 && paddle.vy < 0) ||
        (nextY === FIELD_H - paddle.h - 34 && paddle.vy > 0);
      paddle.y = nextY;
      if (pushingOut) paddle.vy = 0;
    }
  }

  function updatePlayer(dt) {
    let intent = 0;
    if (keys.has("ArrowUp") || keys.has("KeyW")) intent -= 1;
    if (keys.has("ArrowDown") || keys.has("KeyS")) intent += 1;

    if (pointerY !== null) {
      const target = pointerY - state.player.h / 2;
      const delta = target - state.player.y;
      intent = Math.abs(delta) > 8 ? Math.sign(delta) : 0;
    }

    state.player.vy = updatePaddleVelocity(
      state.player.vy,
      intent,
      PLAYER_ACCEL,
      PLAYER_BRAKE,
      PLAYER_MAX_SPEED,
      dt
    );
    state.player.y += state.player.vy * dt;

    if (pointerY !== null) {
      const target = pointerY - state.player.h / 2;
      if (Math.abs(target - state.player.y) < 7 && Math.abs(state.player.vy) < 220) {
        state.player.y = target;
        state.player.vy = 0;
      }
    }

    keepPaddleInBounds(state.player);
  }

  function updateOpponent(dt) {
    const ball = state.ball;
    const opponent = state.opponent;
    const center = rectCenterY(opponent);
    const aimNoise = Math.sin((state.rally + state.player.score * 3 + state.opponent.score) * 1.9) * 34;
    const target = ball.vx > 0 ? ball.y + aimNoise : FIELD_H / 2;
    const diff = target - center;
    const deadZone = ball.vx > 0 ? 10 : 26;

    const intent = Math.abs(diff) <= deadZone ? 0 : Math.sign(diff);

    opponent.vy = updatePaddleVelocity(opponent.vy, intent, AI_ACCEL, AI_BRAKE, AI_MAX_SPEED, dt);
    opponent.y += opponent.vy * dt;
    keepPaddleInBounds(opponent);
  }

  function updateBall(dt) {
    const ball = state.ball;

    ball.vy = clamp(ball.vy + ball.spin * SPIN_CURVE_ACCEL * dt, -MAX_BALL_VY, MAX_BALL_VY);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.spin = approach(ball.spin, 0, SPIN_DECAY * dt);

    if (ball.y - ball.r <= 32) {
      ball.y = 32 + ball.r;
      ball.vy = Math.abs(ball.vy);
      ball.spin *= 0.78;
    }

    if (ball.y + ball.r >= FIELD_H - 32) {
      ball.y = FIELD_H - 32 - ball.r;
      ball.vy = -Math.abs(ball.vy);
      ball.spin *= 0.78;
    }

    if (ball.vx < 0 && ballHitsPaddle(state.player)) {
      bounceFromPaddle(state.player, 1);
      if (state.mode === "gameover") return;
    }

    if (ball.vx > 0 && ballHitsPaddle(state.opponent)) {
      bounceFromPaddle(state.opponent, -1);
      if (state.mode === "gameover") return;
    }

    if (ball.x < -ball.r) {
      awardPoint("opponent");
    } else if (ball.x > FIELD_W + ball.r) {
      awardPoint("player");
    }
  }

  function update(dt) {
    const step = Math.min(dt, 1 / 30);

    if (state.spinNotice.timer > 0) {
      state.spinNotice.timer = Math.max(0, state.spinNotice.timer - step);
    }

    if (state.mode === "point") {
      state.pointTimer -= step;
      if (state.pointTimer <= 0) {
        state.mode = "playing";
      }
      return;
    }

    if (state.mode !== "playing") return;

    updatePlayer(step);
    updateOpponent(step);
    updateBall(step);
  }

  function drawRoundedRect(x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function drawField() {
    const grd = ctx.createLinearGradient(0, 0, FIELD_W, FIELD_H);
    grd.addColorStop(0, "#f9fcfd");
    grd.addColorStop(0.48, "#eef6f2");
    grd.addColorStop(1, "#f7f1eb");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);

    ctx.fillStyle = "#d7e4e8";
    ctx.fillRect(0, 28, FIELD_W, 4);
    ctx.fillRect(0, FIELD_H - 32, FIELD_W, 4);

    ctx.strokeStyle = "rgba(47, 76, 88, 0.28)";
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 20]);
    ctx.beginPath();
    ctx.moveTo(FIELD_W / 2, 42);
    ctx.lineTo(FIELD_W / 2, FIELD_H - 42);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(47, 76, 88, 0.14)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(FIELD_W / 2, FIELD_H / 2, 88, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawScore() {
    ctx.font = "700 72px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(31, 42, 51, 0.16)";
    ctx.fillText(formatScore(state.player.score), FIELD_W / 2 - 190, 104);
    ctx.fillText(formatScore(state.opponent.score), FIELD_W / 2 + 190, 104);
  }

  function drawPaddle(paddle, color, shadow) {
    ctx.save();
    ctx.shadowColor = shadow;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    drawRoundedRect(paddle.x, paddle.y, paddle.w, paddle.h, 7);
    ctx.restore();

    ctx.fillStyle = "rgba(255, 255, 255, 0.52)";
    drawRoundedRect(paddle.x + 4, paddle.y + 10, 4, paddle.h - 20, 3);
  }

  function drawBall() {
    const ball = state.ball;
    const spinAlpha = clamp(Math.abs(ball.spin), 0, 1);

    if (spinAlpha > 0.03) {
      ctx.save();
      ctx.strokeStyle = ball.spin > 0
        ? `rgba(28, 132, 180, ${0.2 + spinAlpha * 0.5})`
        : `rgba(239, 92, 67, ${0.2 + spinAlpha * 0.5})`;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      if (ball.spin > 0) {
        ctx.arc(ball.x, ball.y, ball.r + 8, -0.2 * Math.PI, 0.95 * Math.PI);
      } else {
        ctx.arc(ball.x, ball.y, ball.r + 8, 1.05 * Math.PI, 2.2 * Math.PI);
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = "rgba(236, 89, 59, 0.38)";
    ctx.shadowBlur = 22;
    ctx.fillStyle = "#ef5c43";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
    ctx.beginPath();
    ctx.arc(ball.x - 3, ball.y - 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSpinNotice() {
    if (state.spinNotice.timer <= 0) return;

    const alpha = clamp(state.spinNotice.timer / 0.9, 0, 1);
    const drift = (1 - alpha) * 28;
    const x = state.spinNotice.x + (state.spinNotice.side === "player" ? 34 : -34);
    const y = state.spinNotice.y - drift;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 28px Inter, system-ui, sans-serif";
    ctx.fillStyle = state.spinNotice.side === "player" ? "#1c84b4" : "#283742";
    ctx.fillText(`+${formatScore(state.spinNotice.amount)}`, x, y);
    ctx.font = "700 14px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#607580";
    ctx.fillText("SPIN", x, y + 27);
    ctx.restore();
  }

  function drawButtonHint(text, x, y, w) {
    ctx.fillStyle = "rgba(31, 42, 51, 0.08)";
    drawRoundedRect(x - w / 2, y - 24, w, 48, 8);
    ctx.strokeStyle = "rgba(31, 42, 51, 0.16)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - w / 2 + 1, y - 23, w - 2, 46);
    ctx.fillStyle = "#24323b";
    ctx.font = "700 22px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 1);
  }

  function drawOverlay(title, subtitle, actionText) {
    ctx.fillStyle = "rgba(249, 252, 253, 0.84)";
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);

    ctx.fillStyle = "#1f2a33";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 78px Inter, system-ui, sans-serif";
    ctx.fillText(title, FIELD_W / 2, 254);

    ctx.fillStyle = "#49616e";
    ctx.font = "500 27px Inter, system-ui, sans-serif";
    ctx.fillText(subtitle, FIELD_W / 2, 323);

    drawButtonHint(actionText, FIELD_W / 2, 405, 310);

    ctx.fillStyle = "#607580";
    ctx.font = "500 21px Inter, system-ui, sans-serif";
    ctx.fillText("W/S・↑/↓・ドラッグで移動  長押し加速  P/Enterで一時停止", FIELD_W / 2, 478);
  }

  function drawPointNotice() {
    if (state.mode !== "point") return;

    const sideLabel = state.lastPoint === "player" ? "あなたのポイント" : "相手のポイント";
    const label = `${sideLabel} +${formatScore(state.lastPointAmount)}`;
    ctx.fillStyle = "rgba(249, 252, 253, 0.72)";
    ctx.fillRect(0, FIELD_H / 2 - 58, FIELD_W, 116);
    ctx.fillStyle = "#1f2a33";
    ctx.font = "800 42px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, FIELD_W / 2, FIELD_H / 2);
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, FIELD_W, FIELD_H);
    drawField();
    drawScore();
    drawPaddle(state.player, "#1c84b4", "rgba(28, 132, 180, 0.28)");
    drawPaddle(state.opponent, "#283742", "rgba(40, 55, 66, 0.24)");
    drawBall();
    drawSpinNotice();
    drawPointNotice();

    if (state.mode === "menu") {
      drawOverlay("PING PONG", "7.00点先取。速いパドルほど強い回転になります。", "クリック / Spaceで開始");
    } else if (state.mode === "paused") {
      drawOverlay("PAUSE", "ラリーはここで止まっています。", "P / Enter / Spaceで再開");
    } else if (state.mode === "gameover") {
      const won = state.winner === "player";
      drawOverlay(won ? "YOU WIN" : "YOU LOSE", `${formatScore(state.player.score)} - ${formatScore(state.opponent.score)}`, "Spaceで再戦");
    }
  }

  function frame(now) {
    const seconds = lastTime ? (now - lastTime) / 1000 : 0;
    lastTime = now;
    update(seconds);
    render();
    rafId = requestAnimationFrame(frame);
  }

  function resizeCanvas() {
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = Math.round(FIELD_W * dpr);
    canvas.height = Math.round(FIELD_H * dpr);
    render();
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * FIELD_W,
      y: ((event.clientY - rect.top) / rect.height) * FIELD_H,
    };
  }

  function togglePause() {
    if (state.mode === "playing") {
      state.mode = "paused";
    } else if (state.mode === "paused") {
      state.mode = "playing";
      lastTime = performance.now();
    }
  }

  function handleStartResume() {
    resumeAudio();

    if (state.mode === "menu" || state.mode === "gameover") {
      startGame();
    } else if (state.mode === "paused") {
      state.mode = "playing";
      lastTime = performance.now();
    }
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await canvas.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
    resizeCanvas();
  }

  canvas.addEventListener("pointerdown", (event) => {
    resumeAudio();
    canvas.setPointerCapture(event.pointerId);
    pointerY = canvasPoint(event).y;
    handleStartResume();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (event.buttons) {
      pointerY = canvasPoint(event).y;
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    pointerY = null;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  });

  canvas.addEventListener("pointercancel", (event) => {
    pointerY = null;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  });

  window.addEventListener("keydown", (event) => {
    keys.add(event.code);

    if (event.code === "Space") {
      event.preventDefault();
      resumeAudio();
      handleStartResume();
    } else if (event.code === "KeyP" || event.code === "Enter") {
      resumeAudio();
      togglePause();
    } else if (event.code === "KeyR") {
      resumeAudio();
      startGame();
    } else if (event.code === "KeyF") {
      toggleFullscreen();
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  window.addEventListener("blur", () => {
    keys.clear();
  });

  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("fullscreenchange", resizeCanvas);

  window.advanceTime = (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      update(1 / 60);
    }
    render();
  };

  window.render_game_to_text = () => {
    const payload = {
      coordinateSystem: "origin top-left, x right, y down, logical canvas 1280x720",
      mode: state.mode,
      score: {
        player: round2(state.player.score),
        opponent: round2(state.opponent.score),
        playerDisplay: formatScore(state.player.score),
        opponentDisplay: formatScore(state.opponent.score),
        target: SCORE_TO_WIN,
      },
      player: {
        x: Math.round(state.player.x),
        y: Math.round(state.player.y),
        width: state.player.w,
        height: state.player.h,
        velocityY: Math.round(state.player.vy),
      },
      opponent: {
        x: Math.round(state.opponent.x),
        y: Math.round(state.opponent.y),
        width: state.opponent.w,
        height: state.opponent.h,
        velocityY: Math.round(state.opponent.vy),
      },
      ball: {
        x: Math.round(state.ball.x),
        y: Math.round(state.ball.y),
        radius: state.ball.r,
        velocityX: Math.round(state.ball.vx),
        velocityY: Math.round(state.ball.vy),
        speed: Math.round(state.ball.speed),
        spin: round2(state.ball.spin),
      },
      rally: state.rally,
      lastPoint: state.lastPoint,
      lastPointAmount: round2(state.lastPointAmount),
      lastScoreReason: state.lastScoreReason,
      spinNotice: {
        active: state.spinNotice.timer > 0,
        side: state.spinNotice.side,
        amount: round2(state.spinNotice.amount),
      },
      audio: {
        available: state.audio.available,
        unlocked: state.audio.unlocked,
        eventCount: state.audio.eventCount,
        lastCue: state.audio.lastCue,
        lastSpinAmount: round2(state.audio.lastSpinAmount),
        lastCueStrong: state.audio.lastCueStrong,
        strongSpinThreshold: STRONG_SPIN_SOUND_THRESHOLD,
      },
      winner: state.winner,
    };

    return JSON.stringify(payload);
  };

  resizeCanvas();
  rafId = requestAnimationFrame(frame);

  window.addEventListener("beforeunload", () => {
    cancelAnimationFrame(rafId);
  });
})();
