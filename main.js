(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const FIELD_W = 1280;
  const FIELD_H = 720;
  const SCORE_TO_WIN = 7;
  const PLAYER_SPEED = 620;
  const AI_SPEED = 505;
  const PADDLE_W = 20;
  const PADDLE_H = 116;
  const BALL_R = 11;
  const keys = new Set();

  let lastTime = 0;
  let rafId = 0;
  let dpr = 1;
  let pointerY = null;

  const state = {
    mode: "menu",
    pointTimer: 0,
    lastPoint: null,
    winner: null,
    rally: 0,
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
    },
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function randSign() {
    return Math.random() < 0.5 ? -1 : 1;
  }

  function resetScores() {
    state.player.score = 0;
    state.opponent.score = 0;
    state.winner = null;
    state.lastPoint = null;
    state.rally = 0;
  }

  function resetBall(direction = randSign()) {
    const angle = (Math.random() * 0.62 - 0.31);
    const speed = 440;
    state.ball.x = FIELD_W / 2;
    state.ball.y = FIELD_H / 2;
    state.ball.speed = speed;
    state.ball.vx = Math.cos(angle) * speed * direction;
    state.ball.vy = Math.sin(angle) * speed;
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

  function awardPoint(side) {
    if (side === "player") {
      state.player.score += 1;
      state.lastPoint = "player";
    } else {
      state.opponent.score += 1;
      state.lastPoint = "opponent";
    }

    state.rally = 0;

    if (state.player.score >= SCORE_TO_WIN || state.opponent.score >= SCORE_TO_WIN) {
      state.mode = "gameover";
      state.winner = state.player.score > state.opponent.score ? "player" : "opponent";
      resetBall(side === "player" ? -1 : 1);
      return;
    }

    state.mode = "point";
    state.pointTimer = 0.9;
    resetBall(side === "player" ? -1 : 1);
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

    ball.speed = speed;
    ball.vx = Math.cos(angle) * speed * direction;
    ball.vy = Math.sin(angle) * speed + paddle.vy * 0.16;
    ball.x = direction > 0 ? paddle.x + paddle.w + ball.r : paddle.x - ball.r;
    state.rally += 1;
  }

  function updatePlayer(dt) {
    let intent = 0;
    if (keys.has("ArrowUp") || keys.has("KeyW")) intent -= 1;
    if (keys.has("ArrowDown") || keys.has("KeyS")) intent += 1;

    if (pointerY !== null) {
      const target = pointerY - state.player.h / 2;
      const delta = target - state.player.y;
      const maxStep = PLAYER_SPEED * 1.2 * dt;
      state.player.vy = clamp(delta / Math.max(dt, 0.001), -PLAYER_SPEED * 1.2, PLAYER_SPEED * 1.2);
      state.player.y += clamp(delta, -maxStep, maxStep);
    } else {
      state.player.vy = intent * PLAYER_SPEED;
      state.player.y += state.player.vy * dt;
    }

    state.player.y = clamp(state.player.y, 34, FIELD_H - state.player.h - 34);
  }

  function updateOpponent(dt) {
    const ball = state.ball;
    const opponent = state.opponent;
    const center = rectCenterY(opponent);
    const aimNoise = Math.sin((state.rally + state.player.score * 3 + state.opponent.score) * 1.9) * 34;
    const target = ball.vx > 0 ? ball.y + aimNoise : FIELD_H / 2;
    const diff = target - center;
    const deadZone = ball.vx > 0 ? 10 : 26;

    if (Math.abs(diff) <= deadZone) {
      opponent.vy = 0;
    } else {
      opponent.vy = Math.sign(diff) * AI_SPEED;
    }

    opponent.y += opponent.vy * dt;
    opponent.y = clamp(opponent.y, 34, FIELD_H - opponent.h - 34);
  }

  function updateBall(dt) {
    const ball = state.ball;

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.y - ball.r <= 32) {
      ball.y = 32 + ball.r;
      ball.vy = Math.abs(ball.vy);
    }

    if (ball.y + ball.r >= FIELD_H - 32) {
      ball.y = FIELD_H - 32 - ball.r;
      ball.vy = -Math.abs(ball.vy);
    }

    if (ball.vx < 0 && ballHitsPaddle(state.player)) {
      bounceFromPaddle(state.player, 1);
    }

    if (ball.vx > 0 && ballHitsPaddle(state.opponent)) {
      bounceFromPaddle(state.opponent, -1);
    }

    if (ball.x < -ball.r) {
      awardPoint("opponent");
    } else if (ball.x > FIELD_W + ball.r) {
      awardPoint("player");
    }
  }

  function update(dt) {
    const step = Math.min(dt, 1 / 30);

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
    ctx.font = "700 88px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(31, 42, 51, 0.16)";
    ctx.fillText(String(state.player.score), FIELD_W / 2 - 150, 104);
    ctx.fillText(String(state.opponent.score), FIELD_W / 2 + 150, 104);
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
    ctx.fillText("W/S・↑/↓・ドラッグで移動  P/Enterで一時停止  Fで全画面", FIELD_W / 2, 478);
  }

  function drawPointNotice() {
    if (state.mode !== "point") return;

    const label = state.lastPoint === "player" ? "あなたのポイント" : "相手のポイント";
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
    drawPointNotice();

    if (state.mode === "menu") {
      drawOverlay("PING PONG", "7点先取。クラシックな反射神経勝負です。", "クリック / Spaceで開始");
    } else if (state.mode === "paused") {
      drawOverlay("PAUSE", "ラリーはここで止まっています。", "P / Enter / Spaceで再開");
    } else if (state.mode === "gameover") {
      const won = state.winner === "player";
      drawOverlay(won ? "YOU WIN" : "YOU LOSE", `${state.player.score} - ${state.opponent.score}`, "Spaceで再戦");
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
      handleStartResume();
    } else if (event.code === "KeyP" || event.code === "Enter") {
      togglePause();
    } else if (event.code === "KeyR") {
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
        player: state.player.score,
        opponent: state.opponent.score,
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
      },
      rally: state.rally,
      lastPoint: state.lastPoint,
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
