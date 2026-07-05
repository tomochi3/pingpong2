(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const FIELD_W = 1280;
  const FIELD_H = 720;
  const GAME_VERSION = "v1.8.6";
  const GOALS_TO_END = 5;
  const TUTORIAL_DURATION = 4.2;
  const PLAYER_MAX_SPEED = 900;
  const PLAYER_ACCEL = 1850;
  const PLAYER_BRAKE = 2300;
  const RELEASE_RALLY_THRESHOLD = 0;
  const RELEASE_CHARGE_ACCEL = 2400;
  const RELEASE_SHAKE_BASE_SPEED = 280;
  const RELEASE_SHAKE_SPEED_SCALE = 0.24;
  const RELEASE_SHAKE_BASE_RATE = 42;
  const RELEASE_SHAKE_RATE_SCALE = 0.38;
  const AI_MAX_SPEED = 780;
  const AI_ACCEL = 1500;
  const AI_BRAKE = 1900;
  const PADDLE_W = 20;
  const PADDLE_H = 116;
  const BALL_R = 11;
  const BALL_BASE_SPEED = 440;
  const RALLY_BALL_SPEED_GAIN = 10;
  const CENTER_HIT_SPEED_BONUS = 95;
  const CENTER_HIT_EFFECT_THRESHOLD = 0.86;
  const CENTER_HIT_EFFECT_DURATION = 0.78;
  const SMASH_CHARGE_ACCEL = 420;
  const SMASH_SPEED_BONUS_SCALE = 0.9;
  const SMASH_RELEASE_WINDOW = 0.2;
  const SMASH_MIN_CHARGE = 20;
  const DRAG_MOVE_DEADZONE = 28;
  const DRAG_SMASH_DEADZONE = 42;
  const BALL_MAX_SPEED = 1600;
  const SPIN_SCORE_REFERENCE = 1.6;
  const SPIN_CURVE_BOOST_THRESHOLD = 1;
  const SPIN_ARC_ACCEL = 1250;
  const SPIN_DECAY = 0.32;
  const SPIN_ARC_DECAY = 0.3;
  const BALL_VY_BASE_LIMIT = 760;
  const BALL_VY_CURVE_LIMIT_GAIN = 300;
  const SPIN_REFERENCE_SPEED = PLAYER_MAX_SPEED;
  const STRONG_SPIN_SOUND_THRESHOLD = 0.8;
  const keys = new Set();

  let lastTime = 0;
  let rafId = 0;
  let dpr = 1;
  let pointerY = null;
  let cursorY = null;
  let dragControl = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    moveIntent: 0,
  };
  let audioContext = null;
  let network = {
    socket: null,
    connected: false,
    side: "solo",
    host: false,
    playerCount: 0,
    clients: [],
    remoteInputs: {
      left: { up: false, down: false, smash: false },
      right: { up: false, down: false, smash: false },
    },
    lastSnapshotAt: 0,
    lastInputAt: 0,
    lastError: null,
    urls: [],
  };

  const state = {
    mode: "menu",
    pointTimer: 0,
    lastPoint: null,
    lastPointAmount: 0,
    lastScoreReason: null,
    winner: null,
    localTwoPlayer: false,
    lanDuelArmed: false,
    lanDuelActive: false,
    easyMode: true,
    cursorControlMode: false,
    trainingMode: "normal",
    rally: 0,
    goals: {
      player: 0,
      opponent: 0,
      total: 0,
    },
    tutorial: {
      seen: {},
      bubbles: [],
    },
    spinNotice: {
      timer: 0,
      amount: 0,
      side: null,
      x: FIELD_W / 2,
      y: FIELD_H / 2,
    },
    centerHitEffect: {
      timer: 0,
      duration: CENTER_HIT_EFFECT_DURATION,
      side: null,
      x: FIELD_W / 2,
      y: FIELD_H / 2,
      factor: 0,
      speedBonus: 0,
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
      upCharge: 0,
      downCharge: 0,
      smashCharge: 0,
      smashReadyTimer: 0,
      smashLastCharge: 0,
      smashLastSpeedBonus: 0,
      smashStoredSpinVelocity: 0,
      smashReleaseSpinVelocity: 0,
      smashPressedLastFrame: false,
      releaseShakePhase: 0,
      releaseShakePower: 0,
      releaseHeldVelocity: 0,
    },
    opponent: {
      x: FIELD_W - 66 - PADDLE_W,
      y: FIELD_H / 2 - PADDLE_H / 2,
      w: PADDLE_W,
      h: PADDLE_H,
      score: 0,
      vy: 0,
      upCharge: 0,
      downCharge: 0,
      smashCharge: 0,
      smashReadyTimer: 0,
      smashLastCharge: 0,
      smashLastSpeedBonus: 0,
      smashStoredSpinVelocity: 0,
      smashReleaseSpinVelocity: 0,
      smashPressedLastFrame: false,
      releaseShakePhase: 0,
      releaseShakePower: 0,
      releaseHeldVelocity: 0,
    },
    ball: {
      x: FIELD_W / 2,
      y: FIELD_H / 2,
      r: BALL_R,
      vx: 420,
      vy: 120,
      speed: 440,
      spin: 0,
      curveStrength: 0,
      arcDirection: 0,
      lastCenterHitFactor: 0,
      lastCenterHitSpeedBonus: 0,
      lastSmashCharge: 0,
      lastSmashSpeedBonus: 0,
      lastSpinVelocity: 0,
      playerSmashSpeedBonus: 0,
      opponentSmashSpeedBonus: 0,
      lastGoalProtectedSpeed: 0,
      lastGoalSpeedScore: 1,
      trail: [],
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

  function currentPlayerSpeed() {
    return Math.round(Math.abs(localPaddle().vy));
  }

  function currentBallSpeed() {
    return Math.round(state.ball.speed);
  }

  function isTouchDevice() {
    return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  }

  function isMobilePortraitView() {
    return isTouchDevice() && window.innerHeight > window.innerWidth;
  }

  function portraitBottomSide() {
    return network.side === "right" ? "right" : "left";
  }

  function displaySize() {
    return isMobilePortraitView()
      ? { width: FIELD_H, height: FIELD_W }
      : { width: FIELD_W, height: FIELD_H };
  }

  function viewportInfo() {
    const rect = canvas.getBoundingClientRect();
    const display = displaySize();
    return {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
      canvasCssWidth: Math.round(rect.width),
      canvasCssHeight: Math.round(rect.height),
      displayWidth: display.width,
      displayHeight: display.height,
      coarsePointer: isTouchDevice(),
      orientation: window.innerWidth >= window.innerHeight ? "landscape" : "portrait",
      portraitBoard: isMobilePortraitView(),
      bottomSide: isMobilePortraitView() ? portraitBottomSide() : null,
    };
  }

  function isReleaseMode() {
    return state.rally >= RELEASE_RALLY_THRESHOLD;
  }

  function isNetworkGame() {
    return network.connected && network.side !== "solo";
  }

  function isNetworkHost() {
    return isNetworkGame() && network.host;
  }

  function networkPlayerCount() {
    return network.clients.filter((client) => client.side === "left" || client.side === "right").length;
  }

  function hasNetworkRightPlayer() {
    return network.clients.some((client) => client.side === "right");
  }

  function canStartLanDuel() {
    return isNetworkGame() && network.side !== "spectator" && networkPlayerCount() >= 2;
  }

  function maybeAutoStartArmedLanDuel() {
    if (!network.host || !state.lanDuelArmed || state.mode !== "menu" || !canStartLanDuel()) return;
    startLanDuelGame();
  }

  function isLocalTwoPlayer() {
    return state.localTwoPlayer && !isNetworkGame();
  }

  function isEasyModePaddle(paddle) {
    return state.easyMode && !state.cursorControlMode && paddle === state.player;
  }

  function isCursorModePaddle(paddle) {
    return state.cursorControlMode && paddle === state.player && cursorY !== null;
  }

  function isTrainingOpponent() {
    return !hasHumanRightPlayer() && (state.trainingMode === "training" || state.trainingMode === "hard");
  }

  function isHardTrainingOpponentPaddle(paddle) {
    return isTrainingOpponent() && state.trainingMode === "hard" && paddle === state.opponent;
  }

  function trainingModeLabel(mode = state.trainingMode) {
    if (mode === "hard") return "ハード";
    if (mode === "training") return "トレーニング";
    return "通常";
  }

  function cycleTrainingMode() {
    if (state.trainingMode === "normal") {
      state.trainingMode = "training";
    } else if (state.trainingMode === "training") {
      state.trainingMode = "hard";
    } else {
      state.trainingMode = "normal";
    }
  }

  function hasHumanRightPlayer() {
    return isLocalTwoPlayer() || (isNetworkHost() && state.lanDuelActive && hasNetworkRightPlayer());
  }

  function sideToPaddle(side) {
    return side === "right" ? state.opponent : state.player;
  }

  function sideToScoreSide(side) {
    return side === "right" ? "opponent" : "player";
  }

  function localPaddle() {
    return network.side === "right" ? state.opponent : state.player;
  }

  function localInputSide() {
    return network.side === "right" ? "right" : "left";
  }

  function sideForKey(code) {
    if (isLocalTwoPlayer()) {
      if (code === "ArrowUp" || code === "ArrowDown" || code === "ArrowLeft") return "right";
      if (code === "KeyW" || code === "KeyS" || code === "KeyA") return "left";
    }

    return localInputSide();
  }

  function isMoveKey(code) {
    return code === "ArrowUp" || code === "KeyW" || code === "ArrowDown" || code === "KeyS";
  }

  function isSmashKey(code) {
    return code === "ArrowLeft" || code === "KeyA";
  }

  function dragInput() {
    if (!dragControl.active) {
      return {
        dx: 0,
        dy: 0,
        up: false,
        down: false,
        smash: false,
        moveIntent: 0,
      };
    }

    const dx = dragControl.x - dragControl.startX;
    const dy = dragControl.y - dragControl.startY;
    const up = dy < -DRAG_MOVE_DEADZONE;
    const down = dy > DRAG_MOVE_DEADZONE;
    const portraitRightCharge = isMobilePortraitView() && portraitBottomSide() === "right";
    const smash = portraitRightCharge
      ? dx > DRAG_SMASH_DEADZONE
      : dx < -DRAG_SMASH_DEADZONE;

    return {
      dx,
      dy,
      up,
      down,
      smash,
      moveIntent: up ? -1 : down ? 1 : 0,
    };
  }

  function isUpPressed() {
    const drag = dragInput();
    return keys.has("ArrowUp") || keys.has("KeyW") || drag.up;
  }

  function isDownPressed() {
    const drag = dragInput();
    return keys.has("ArrowDown") || keys.has("KeyS") || drag.down;
  }

  function isSmashPressed() {
    return keys.has("ArrowLeft") || keys.has("KeyA") || dragInput().smash;
  }

  function keyboardInputForSide(side) {
    if (side === "right") {
      return {
        up: keys.has("ArrowUp"),
        down: keys.has("ArrowDown"),
        smash: keys.has("ArrowLeft"),
      };
    }

    return {
      up: keys.has("KeyW"),
      down: keys.has("KeyS"),
      smash: keys.has("KeyA"),
    };
  }

  function soloControlInput() {
    return {
      up: isUpPressed(),
      down: isDownPressed(),
      smash: isSmashPressed(),
    };
  }

  function localControlInput(side = "left") {
    if (isLocalTwoPlayer()) {
      const keyboard = keyboardInputForSide(side);
      if (side !== "left") return keyboard;

      const drag = dragInput();
      return {
        up: keyboard.up || drag.up,
        down: keyboard.down || drag.down,
        smash: keyboard.smash || drag.smash,
      };
    }

    return soloControlInput();
  }

  function inputForSide(side) {
    if (isLocalTwoPlayer()) {
      return localControlInput(side);
    }

    if (!isNetworkGame()) {
      return side === "left" ? localControlInput("left") : { up: false, down: false, smash: false };
    }

    if (network.side === side) {
      return localControlInput(side);
    }

    return network.remoteInputs[side] || { up: false, down: false, smash: false };
  }

  function activateTutorial(tutorial) {
    state.tutorial.seen[tutorial.id] = true;
    state.tutorial.bubbles = [{
      ...tutorial,
      lines: Array.isArray(tutorial.lines) ? tutorial.lines : [tutorial.lines],
      timer: TUTORIAL_DURATION,
      duration: TUTORIAL_DURATION,
    }];
  }

  function showTutorial(id, lines, x, y, side = "left") {
    if (state.tutorial.seen[id] || state.tutorial.bubbles.length) return false;

    const tutorial = {
      id,
      lines: Array.isArray(lines) ? lines : [lines],
      x,
      y,
      side,
    };

    activateTutorial(tutorial);
    return true;
  }

  function resetPaddleRelease(paddle) {
    paddle.upCharge = 0;
    paddle.downCharge = 0;
    paddle.releaseShakePhase = 0;
    paddle.releaseShakePower = 0;
    paddle.releaseHeldVelocity = 0;
  }

  function resetReleaseCharges() {
    resetPaddleRelease(state.player);
    resetPaddleRelease(state.opponent);
  }

  function resetPaddleSmash(paddle) {
    paddle.smashCharge = 0;
    paddle.smashReadyTimer = 0;
    paddle.smashLastCharge = 0;
    paddle.smashLastSpeedBonus = 0;
    paddle.smashStoredSpinVelocity = 0;
    paddle.smashReleaseSpinVelocity = 0;
    paddle.smashPressedLastFrame = false;
  }

  function resetSmashCharge() {
    resetPaddleSmash(state.player);
    resetPaddleSmash(state.opponent);
  }

  function resetDragControl() {
    dragControl = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      x: 0,
      y: 0,
      moveIntent: 0,
    };
    pointerY = null;
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
    state.goals.player = 0;
    state.goals.opponent = 0;
    state.goals.total = 0;
    state.winner = null;
    state.lastPoint = null;
    state.lastPointAmount = 0;
    state.lastScoreReason = null;
    state.rally = 0;
    state.spinNotice.timer = 0;
    state.centerHitEffect.timer = 0;
    state.ball.lastGoalProtectedSpeed = 0;
    state.ball.lastGoalSpeedScore = 1;
    resetReleaseCharges();
  }

  function resetBall(direction = randSign()) {
    const angle = (Math.random() * 0.62 - 0.31);
    const speed = BALL_BASE_SPEED;
    state.ball.x = FIELD_W / 2;
    state.ball.y = FIELD_H / 2;
    state.ball.speed = speed;
    state.ball.vx = Math.cos(angle) * speed * direction;
    state.ball.vy = Math.sin(angle) * speed;
    state.ball.spin = 0;
    state.ball.curveStrength = 0;
    state.ball.arcDirection = 0;
    state.ball.lastCenterHitFactor = 0;
    state.ball.lastCenterHitSpeedBonus = 0;
    state.ball.lastSmashCharge = 0;
    state.ball.lastSmashSpeedBonus = 0;
    state.ball.lastSpinVelocity = 0;
    state.ball.playerSmashSpeedBonus = 0;
    state.ball.opponentSmashSpeedBonus = 0;
    state.ball.trail = [];
    state.centerHitEffect.timer = 0;
  }

  function resetPaddles() {
    state.player.y = FIELD_H / 2 - state.player.h / 2;
    state.opponent.y = FIELD_H / 2 - state.opponent.h / 2;
    state.player.vy = 0;
    state.opponent.vy = 0;
    resetReleaseCharges();
    resetSmashCharge();
    resetDragControl();
  }

  function startGame(options = {}) {
    state.localTwoPlayer = Boolean(options.localTwoPlayer);
    state.lanDuelActive = Boolean(options.lanDuel) && isNetworkGame();
    state.lanDuelArmed = false;
    if (Object.prototype.hasOwnProperty.call(options, "easyMode")) {
      state.easyMode = Boolean(options.easyMode);
    }
    resetScores();
    resetPaddles();
    resetBall(randSign());
    state.mode = "playing";
    forceNetworkSnapshot();
  }

  function startLanDuelGame() {
    resumeAudio();
    if (!isNetworkGame()) {
      network.lastError = "LAN server unavailable";
      return;
    }
    if (network.side === "spectator") {
      return;
    }
    if (!network.host) {
      sendNetworkControl("start-lan-duel");
      return;
    }
    if (!canStartLanDuel()) {
      state.lanDuelActive = false;
      state.lanDuelArmed = true;
      state.mode = "menu";
      return;
    }
    startGame({ localTwoPlayer: false, lanDuel: true, easyMode: false });
  }

  function startLocalTwoPlayerGame() {
    resumeAudio();
    if (isNetworkGame() && !network.host) {
      return;
    }
    startGame({ localTwoPlayer: true });
  }

  function addScore(side, amount) {
    const target = side === "player" ? state.player : state.opponent;
    target.score = round2(target.score + amount);
    state.lastPoint = side;
    state.lastPointAmount = amount;
  }

  function armSmashReleaseForPaddle(paddle) {
    if (state.mode !== "playing" && state.mode !== "point") return;

    paddle.smashLastCharge = paddle.smashCharge;
    paddle.smashReleaseSpinVelocity = paddle.smashStoredSpinVelocity || 0;
    paddle.smashStoredSpinVelocity = 0;
    paddle.smashCharge = 0;
    paddle.smashLastSpeedBonus = 0;
    paddle.smashReadyTimer = paddle.smashLastCharge >= SMASH_MIN_CHARGE ? SMASH_RELEASE_WINDOW : 0;
    paddle.smashPressedLastFrame = false;
  }

  function armSmashRelease() {
    armSmashReleaseForPaddle(localPaddle());
  }

  function goalScoreAmount(side) {
    const rawProtectedSpeed = side === "opponent"
      ? state.ball.playerSmashSpeedBonus
      : state.ball.opponentSmashSpeedBonus;
    const protectedSpeed = Math.min(rawProtectedSpeed, Math.max(0, state.ball.speed - BALL_BASE_SPEED));
    const scoringSpeed = Math.max(BALL_BASE_SPEED, state.ball.speed - protectedSpeed);
    const speedOverBase = Math.max(0, scoringSpeed - BALL_BASE_SPEED);
    const speedScore = 1 + Math.pow(speedOverBase / 180, 1.45);
    state.ball.lastGoalProtectedSpeed = Math.round(protectedSpeed);
    state.ball.lastGoalSpeedScore = round2(speedScore);
    return round2(speedScore);
  }

  function checkWinner() {
    if (state.goals.total < GOALS_TO_END) {
      return false;
    }

    state.mode = "gameover";
    state.winner = state.player.score === state.opponent.score
      ? "draw"
      : state.player.score > state.opponent.score ? "player" : "opponent";
    resetBall(state.winner === "player" ? -1 : 1);
    return true;
  }

  function awardPoint(side) {
    const amount = goalScoreAmount(side);
    addScore(side, amount);
    state.goals[side] += 1;
    state.goals.total += 1;
    showTutorial(
      "goal-count",
      ["5ゴールで終了。スピン点は別"],
      FIELD_W / 2,
      178,
      "center"
    );
    state.lastScoreReason = "miss";
    playPointSound(side);

    state.rally = 0;
    resetReleaseCharges();
    resetSmashCharge();

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

    return false;
  }

  function triggerCenterHitEffect(side, x, y, factor, speedBonus) {
    if (factor < CENTER_HIT_EFFECT_THRESHOLD) return;

    state.centerHitEffect = {
      timer: CENTER_HIT_EFFECT_DURATION,
      duration: CENTER_HIT_EFFECT_DURATION,
      side,
      x,
      y: clamp(y, 78, FIELD_H - 78),
      factor,
      speedBonus,
    };
  }

  function rectCenterY(rect) {
    return rect.y + rect.h / 2;
  }

  function paddleCollision(paddle, previousX, previousY) {
    const ball = state.ball;
    const overlapping = (
      ball.x + ball.r >= paddle.x &&
      ball.x - ball.r <= paddle.x + paddle.w &&
      ball.y + ball.r >= paddle.y &&
      ball.y - ball.r <= paddle.y + paddle.h
    );
    if (overlapping) {
      return { hit: true, y: ball.y };
    }

    if (previousX === ball.x) {
      return { hit: false, y: ball.y };
    }

    const frontX = paddle === state.player ? paddle.x + paddle.w + ball.r : paddle.x - ball.r;
    const crossedFront = paddle === state.player
      ? previousX >= frontX && ball.x <= frontX
      : previousX <= frontX && ball.x >= frontX;
    if (!crossedFront) {
      return { hit: false, y: ball.y };
    }

    const t = clamp((frontX - previousX) / (ball.x - previousX), 0, 1);
    const contactY = previousY + (ball.y - previousY) * t;
    const hitY = contactY + ball.r >= paddle.y && contactY - ball.r <= paddle.y + paddle.h;
    return { hit: hitY, y: contactY };
  }

  function spinVelocityForPaddle(paddle) {
    return paddle.smashReadyTimer > 0 ? paddle.smashReleaseSpinVelocity || 0 : 0;
  }

  function currentSpinChargeVelocity(paddle) {
    const heldVelocity = paddle.releaseHeldVelocity || 0;
    return Math.abs(heldVelocity) > Math.abs(paddle.vy) ? heldVelocity : paddle.vy;
  }

  function storeSmashSpinVelocity(paddle) {
    const spinVelocity = currentSpinChargeVelocity(paddle);
    if (Math.abs(spinVelocity) > Math.abs(paddle.smashStoredSpinVelocity || 0)) {
      paddle.smashStoredSpinVelocity = spinVelocity;
    }
  }

  function spinCurveStrength(spinAmount, offset) {
    const overOneBoost = spinAmount >= SPIN_CURVE_BOOST_THRESHOLD
      ? 0.55 + (spinAmount - SPIN_CURVE_BOOST_THRESHOLD) * 1.25
      : 0;
    return spinAmount * 0.75 + overOneBoost + Math.abs(offset) * 0.18;
  }

  function ballVerticalLimit(curveStrength = state.ball.curveStrength) {
    return BALL_VY_BASE_LIMIT + Math.max(0, curveStrength) * BALL_VY_CURVE_LIMIT_GAIN;
  }

  function centerHitFactor(offset) {
    return clamp(1 - Math.abs(offset), 0, 1);
  }

  function updateSmashChargeForPaddle(paddle, input, dt) {
    if (state.mode !== "playing" && state.mode !== "point") return;

    if (input.smash) {
      paddle.smashCharge += SMASH_CHARGE_ACCEL * dt;
      paddle.smashReadyTimer = 0;
      paddle.smashReleaseSpinVelocity = 0;
      storeSmashSpinVelocity(paddle);
      paddle.smashPressedLastFrame = true;
      return;
    }

    if (paddle.smashPressedLastFrame) {
      armSmashReleaseForPaddle(paddle);
      return;
    }

    if (paddle.smashReadyTimer > 0) {
      paddle.smashReadyTimer = Math.max(0, paddle.smashReadyTimer - dt);
      if (paddle.smashReadyTimer <= 0) {
        paddle.smashReleaseSpinVelocity = 0;
      }
    }
  }

  function updateSmashCharge(dt) {
    updateSmashChargeForPaddle(state.player, inputForSide("left"), dt);
    if (hasHumanRightPlayer()) {
      updateSmashChargeForPaddle(state.opponent, inputForSide("right"), dt);
    }
  }

  function paddleCanHitBall(paddle) {
    return paddle.smashCharge <= 0;
  }

  function bounceFromPaddle(paddle, direction) {
    const ball = state.ball;
    const offset = clamp((ball.y - rectCenterY(paddle)) / (paddle.h / 2), -1, 1);
    const centerFactor = centerHitFactor(offset);
    const centerSpeedBonus = CENTER_HIT_SPEED_BONUS * centerFactor * centerFactor;
    const smashCharge = paddle.smashLastCharge || 0;
    const smashSpeedBonus = smashCharge * SMASH_SPEED_BONUS_SCALE;
    const speedBeforeHit = ball.speed;
    const hardTraining = isHardTrainingOpponentPaddle(paddle);
    const hardTrainingSpeedBonus = hardTraining ? 170 + Math.min(state.rally * 8, 180) : 0;
    const speedWithoutSmash = Math.min(speedBeforeHit + RALLY_BALL_SPEED_GAIN + centerSpeedBonus + hardTrainingSpeedBonus, BALL_MAX_SPEED);
    const speed = Math.min(speedWithoutSmash + smashSpeedBonus, BALL_MAX_SPEED);
    const appliedSmashSpeedBonus = Math.max(0, speed - speedWithoutSmash);
    const angle = offset * 0.88;
    const side = direction > 0 ? "player" : "opponent";
    const hardTrainingSpinVelocity = hardTraining
      ? (Math.sin(state.rally * 1.7 + state.opponent.score * 0.9) >= 0 ? 1 : -1) * (760 + Math.min(state.rally * 18, 620))
      : 0;
    const baseSpinVelocity = spinVelocityForPaddle(paddle);
    const spinVelocity = Math.abs(hardTrainingSpinVelocity) > Math.abs(baseSpinVelocity)
      ? hardTrainingSpinVelocity
      : baseSpinVelocity;
    const spinPower = spinVelocity / SPIN_REFERENCE_SPEED;
    const spinAmount = round2(Math.abs(spinPower) * SPIN_SCORE_REFERENCE);
    const curveStrength = spinCurveStrength(spinAmount, offset);
    const verticalLimit = ballVerticalLimit(curveStrength);

    ball.speed = speed;
    ball.vx = Math.cos(angle) * speed * direction;
    ball.vy = clamp(Math.sin(angle) * speed + spinVelocity * 0.16, -verticalLimit, verticalLimit);
    ball.spin = spinPower * 1.35 + offset * 0.22;
    ball.curveStrength = curveStrength;
    ball.arcDirection = Math.sign(ball.spin || spinPower || offset || 1);
    ball.lastCenterHitFactor = centerFactor;
    ball.lastCenterHitSpeedBonus = centerSpeedBonus;
    ball.lastSmashCharge = smashCharge;
    ball.lastSmashSpeedBonus = appliedSmashSpeedBonus;
    ball.lastSpinVelocity = spinVelocity;
    if (paddle === state.player) {
      ball.playerSmashSpeedBonus += appliedSmashSpeedBonus;
    } else if (paddle === state.opponent) {
      ball.opponentSmashSpeedBonus += appliedSmashSpeedBonus;
    }
    ball.trail = [{ x: ball.x, y: ball.y, strength: ball.curveStrength }];
    ball.x = direction > 0 ? paddle.x + paddle.w + ball.r : paddle.x - ball.r;
    paddle.smashReadyTimer = 0;
    paddle.smashReleaseSpinVelocity = 0;
    paddle.smashLastSpeedBonus = appliedSmashSpeedBonus;
    triggerCenterHitEffect(side, ball.x, ball.y, centerFactor, centerSpeedBonus);
    state.rally += 1;

    showTutorial(
      "return-speed",
      ["芯ヒットとラリーで返球加速"],
      FIELD_W / 2,
      FIELD_H - 178,
      "center"
    );
    playPaddleSound(side, spinAmount, spinPower);
    if (spinAmount > 0) {
      showTutorial(
        "spin",
        ["速度でスピン点とカーブ発生"],
        ball.x + (direction > 0 ? 96 : -96),
        ball.y - 78,
        direction > 0 ? "left" : "right"
      );
    }
    awardSpinScore(side, spinAmount, ball.x, ball.y);
  }

  function updatePaddleVelocity(current, intent, accel, brake, maxSpeed, dt) {
    if (intent !== 0) {
      return clamp(current + intent * accel * dt, -maxSpeed, maxSpeed);
    }

    return approach(current, 0, brake * dt);
  }

  function updateReleasePaddleVelocity(paddle, input, dt) {
    if (input.up) {
      paddle.upCharge += RELEASE_CHARGE_ACCEL * dt;
    } else {
      paddle.upCharge = 0;
    }

    if (input.down) {
      paddle.downCharge += RELEASE_CHARGE_ACCEL * dt;
    } else {
      paddle.downCharge = 0;
    }

    paddle.releaseHeldVelocity = paddle.downCharge - paddle.upCharge;

    if (input.up || input.down) {
      if (input.up && input.down) {
        const chargePower = (paddle.upCharge + paddle.downCharge) / 2;
        const shakeRate = RELEASE_SHAKE_BASE_RATE + Math.sqrt(chargePower) * RELEASE_SHAKE_RATE_SCALE;
        const shakeSpeed = RELEASE_SHAKE_BASE_SPEED + chargePower * RELEASE_SHAKE_SPEED_SCALE;
        paddle.releaseShakePhase += shakeRate * dt;
        paddle.releaseShakePower = chargePower;
        paddle.vy = Math.sin(paddle.releaseShakePhase) * shakeSpeed;
      } else {
        paddle.releaseShakePower = 0;
        paddle.vy = input.down ? paddle.downCharge : -paddle.upCharge;
      }
      return;
    }

    paddle.releaseShakePower = 0;
    paddle.releaseHeldVelocity = 0;
    paddle.vy = approach(paddle.vy, 0, PLAYER_BRAKE * dt);
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

  function syncEasyPaddleToBall(paddle) {
    if (!isEasyModePaddle(paddle) || (state.mode !== "playing" && state.mode !== "point")) return;
    paddle.y = state.ball.y - paddle.h / 2;
  }

  function syncCursorPaddle(paddle) {
    if (!isCursorModePaddle(paddle) || (state.mode !== "playing" && state.mode !== "point")) return;
    paddle.y = cursorY - paddle.h / 2;
  }

  function updateHumanPaddle(paddle, input, dt) {
    let intent = 0;
    if (input.up) intent -= 1;
    if (input.down) intent += 1;

    if (pointerY !== null && !isReleaseMode() && paddle === localPaddle()) {
      const target = pointerY - paddle.h / 2;
      const delta = target - paddle.y;
      intent = Math.abs(delta) > 8 ? Math.sign(delta) : 0;
      resetPaddleRelease(paddle);
    }

    if (isReleaseMode()) {
      updateReleasePaddleVelocity(paddle, input, dt);
    } else {
      resetPaddleRelease(paddle);
      paddle.vy = updatePaddleVelocity(
        paddle.vy,
        intent,
        PLAYER_ACCEL,
        PLAYER_BRAKE,
        PLAYER_MAX_SPEED,
        dt
      );
    }

    paddle.y += paddle.vy * dt;

    if (pointerY !== null && !isReleaseMode() && paddle === localPaddle()) {
      const target = pointerY - paddle.h / 2;
      if (Math.abs(target - paddle.y) < 7 && Math.abs(paddle.vy) < 220) {
        paddle.y = target;
        paddle.vy = 0;
      }
    }

    keepPaddleInBounds(paddle);
    syncCursorPaddle(paddle);
    syncEasyPaddleToBall(paddle);
  }

  function updatePlayer(dt) {
    const drag = dragInput();
    dragControl.moveIntent = drag.moveIntent;
    updateHumanPaddle(state.player, inputForSide("left"), dt);
  }

  function updateOpponent(dt) {
    if (hasHumanRightPlayer()) {
      updateHumanPaddle(state.opponent, inputForSide("right"), dt);
      return;
    }

    const ball = state.ball;
    const opponent = state.opponent;
    if (isTrainingOpponent()) {
      const previousY = opponent.y;
      opponent.y = ball.y - opponent.h / 2;
      opponent.vy = dt > 0 ? (opponent.y - previousY) / dt : 0;
      return;
    }

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
    const arc = ball.arcDirection * ball.curveStrength * SPIN_ARC_ACCEL;
    const verticalLimit = ballVerticalLimit();
    const previousX = ball.x;
    const previousY = ball.y;

    ball.vy = clamp(ball.vy + arc * dt, -verticalLimit, verticalLimit);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (Math.abs(ball.spin) > 0.05 || ball.curveStrength > 0.08) {
      const trailLimit = Math.round(clamp(16 + ball.curveStrength * 4, 16, 52));
      ball.trail.push({ x: ball.x, y: ball.y, strength: Math.max(ball.curveStrength, 0.15) });
      while (ball.trail.length > trailLimit) {
        ball.trail.shift();
      }
    } else if (ball.trail.length) {
      ball.trail.shift();
    }
    ball.spin = approach(ball.spin, 0, SPIN_DECAY * dt);
    ball.curveStrength = approach(ball.curveStrength, 0, SPIN_ARC_DECAY * dt);
    if (ball.curveStrength <= 0.01) {
      ball.arcDirection = 0;
    }

    if (ball.y - ball.r <= 32) {
      ball.y = 32 + ball.r;
      ball.vy = Math.abs(ball.vy);
      ball.spin *= 0.78;
      ball.curveStrength *= 0.82;
    }

    if (ball.y + ball.r >= FIELD_H - 32) {
      ball.y = FIELD_H - 32 - ball.r;
      ball.vy = -Math.abs(ball.vy);
      ball.spin *= 0.78;
      ball.curveStrength *= 0.82;
    }

    syncCursorPaddle(state.player);
    syncEasyPaddleToBall(state.player);
    if (isTrainingOpponent()) {
      state.opponent.y = ball.y - state.opponent.h / 2;
    }

    const playerCollision = ball.vx < 0 ? paddleCollision(state.player, previousX, previousY) : { hit: false };
    if (playerCollision.hit) {
      if (paddleCanHitBall(state.player)) {
        ball.y = playerCollision.y;
        bounceFromPaddle(state.player, 1);
      }
      if (state.mode === "gameover") return;
    }

    const opponentCollision = ball.vx > 0 ? paddleCollision(state.opponent, previousX, previousY) : { hit: false };
    if (opponentCollision.hit) {
      if (!hasHumanRightPlayer() || paddleCanHitBall(state.opponent)) {
        ball.y = opponentCollision.y;
        bounceFromPaddle(state.opponent, -1);
      }
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
    if (state.centerHitEffect.timer > 0) {
      state.centerHitEffect.timer = Math.max(0, state.centerHitEffect.timer - step);
    }
    updateTutorials(step);
    syncNetworkInput();

    if (isNetworkGame() && !network.host) {
      return;
    }

    updateSmashCharge(step);

    if (state.mode === "point") {
      updatePlayer(step);
      updateOpponent(step);
      state.pointTimer -= step;
      if (state.pointTimer <= 0) {
        state.mode = "playing";
      }
      syncNetworkSnapshot();
      return;
    }

    if (state.mode !== "playing") return;

    updatePlayer(step);
    updateOpponent(step);
    updateBall(step);
    syncNetworkSnapshot();
  }

  function updateTutorials(dt) {
    state.tutorial.bubbles = state.tutorial.bubbles
      .map((bubble) => ({ ...bubble, timer: bubble.timer - dt }))
      .filter((bubble) => bubble.timer > 0);
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

  function scoreForSide(side) {
    return side === "right" ? state.opponent.score : state.player.score;
  }

  function scoreSideLabel(side) {
    return side === portraitBottomSide() ? "YOU" : "RIVAL";
  }

  function drawPortraitScore() {
    const display = displaySize();
    const bottomSide = portraitBottomSide();
    const topSide = bottomSide === "right" ? "left" : "right";

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.fillStyle = "rgba(31, 42, 51, 0.13)";
    ctx.font = "800 68px Inter, system-ui, sans-serif";
    ctx.fillText(formatScore(scoreForSide(topSide)), display.width / 2, 96);
    ctx.fillText(formatScore(scoreForSide(bottomSide)), display.width / 2, display.height - 96);

    ctx.fillStyle = "rgba(31, 42, 51, 0.44)";
    ctx.font = "800 16px Inter, system-ui, sans-serif";
    ctx.fillText(scoreSideLabel(topSide), display.width / 2, 142);
    ctx.fillText(scoreSideLabel(bottomSide), display.width / 2, display.height - 142);
    ctx.restore();
  }

  function drawPaddle(paddle, color, shadow) {
    const releaseShake = paddle.releaseShakePower || 0;
    const smashCharge = paddle.smashCharge || 0;
    const smashReady = paddle.smashReadyTimer || 0;

    if (releaseShake > 0) {
      const alpha = clamp(0.12 + releaseShake / 5200, 0.12, 0.34);
      const offset = clamp(7 + releaseShake / 420, 7, 18);

      ctx.save();
      ctx.fillStyle = `rgba(239, 92, 67, ${alpha})`;
      drawRoundedRect(paddle.x - 3, paddle.y - offset, paddle.w + 6, paddle.h, 7);
      ctx.fillStyle = `rgba(28, 132, 180, ${alpha})`;
      drawRoundedRect(paddle.x - 3, paddle.y + offset, paddle.w + 6, paddle.h, 7);
      ctx.restore();
    }

    if (smashCharge > 0 || smashReady > 0) {
      const chargeAlpha = smashReady > 0 ? 0.42 : clamp(0.12 + smashCharge / 2600, 0.12, 0.42);
      const chargeHeight = clamp(18 + smashCharge / 7, 18, paddle.h + 28);

      ctx.save();
      ctx.shadowColor = "rgba(239, 92, 67, 0.38)";
      ctx.shadowBlur = smashReady > 0 ? 28 : 18;
      ctx.fillStyle = `rgba(239, 92, 67, ${chargeAlpha})`;
      drawRoundedRect(paddle.x - 12, rectCenterY(paddle) - chargeHeight / 2, 6, chargeHeight, 4);
      if (smashReady > 0) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
        ctx.lineWidth = 3;
        ctx.strokeRect(paddle.x - 17, paddle.y - 7, paddle.w + 34, paddle.h + 14);
      }
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = shadow;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    drawRoundedRect(paddle.x, paddle.y, paddle.w, paddle.h, 7);
    ctx.restore();

    ctx.fillStyle = "rgba(255, 255, 255, 0.52)";
    drawRoundedRect(paddle.x + 4, paddle.y + 10, 4, paddle.h - 20, 3);
  }

  function drawBallTrail() {
    const trail = state.ball.trail;
    if (!trail.length) return;

    trail.forEach((point, index) => {
      const age = (index + 1) / trail.length;
      const alpha = clamp(age * point.strength * 0.28, 0, 0.34);
      const radius = BALL_R * (0.55 + age * 0.7);

      ctx.fillStyle = `rgba(239, 92, 67, ${alpha})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawBall() {
    const ball = state.ball;
    const spinAlpha = clamp(Math.max(Math.abs(ball.spin) / 1.65, ball.curveStrength), 0, 1);

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

  function drawDragGuide() {
    if (!dragControl.active || (state.mode !== "playing" && state.mode !== "point")) return;

    const drag = dragInput();
    const pull = Math.hypot(drag.dx, drag.dy);
    if (pull < 8) return;

    const alpha = clamp(pull / 180, 0.22, 0.72);

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(31, 42, 51, ${alpha * 0.42})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(dragControl.startX, dragControl.startY);
    ctx.lineTo(dragControl.x, dragControl.y);
    ctx.stroke();

    if (drag.moveIntent !== 0) {
      ctx.strokeStyle = `rgba(28, 132, 180, ${alpha})`;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(dragControl.startX, dragControl.startY);
      ctx.lineTo(dragControl.startX, dragControl.y);
      ctx.stroke();
    }

    if (drag.smash) {
      ctx.strokeStyle = `rgba(239, 92, 67, ${alpha})`;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(dragControl.startX, dragControl.startY);
      ctx.lineTo(dragControl.x, dragControl.startY);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(31, 42, 51, 0.22)";
    ctx.beginPath();
    ctx.arc(dragControl.startX, dragControl.startY, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = drag.smash ? "#ef5c43" : drag.moveIntent !== 0 ? "#1c84b4" : "rgba(31, 42, 51, 0.54)";
    ctx.beginPath();
    ctx.arc(dragControl.x, dragControl.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCenterHitEffect() {
    const effect = state.centerHitEffect;
    if (effect.timer <= 0) return;

    const life = effect.duration || CENTER_HIT_EFFECT_DURATION;
    const alpha = clamp(effect.timer / life, 0, 1);
    const progress = 1 - alpha;
    const intensity = clamp(effect.factor, CENTER_HIT_EFFECT_THRESHOLD, 1);
    const ringSize = 28 + progress * 82 + intensity * 18;
    const textY = -46 - progress * 18;
    const burstCount = 12;

    ctx.save();
    ctx.translate(effect.x, effect.y);
    ctx.globalAlpha = alpha;

    ctx.strokeStyle = "#f4b33d";
    ctx.lineWidth = 5 + (1 - progress) * 8 * intensity;
    ctx.beginPath();
    ctx.arc(0, 0, ringSize, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.86)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, ringSize * 0.55, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "#f4b33d";
    ctx.lineWidth = 3;
    for (let i = 0; i < burstCount; i += 1) {
      const angle = (Math.PI * 2 * i) / burstCount + progress * 0.32;
      const inner = 10 + progress * 16;
      const outer = inner + 22 + intensity * 24 + progress * 20;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 28px Inter, system-ui, sans-serif";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(249, 252, 253, 0.9)";
    ctx.fillStyle = "#1f2a33";
    ctx.strokeText("芯ヒット", 0, textY);
    ctx.fillText("芯ヒット", 0, textY);

    ctx.font = "900 18px Inter, system-ui, sans-serif";
    ctx.fillStyle = effect.side === "player" ? "#1c84b4" : "#ef5c43";
    ctx.fillText(`+${Math.round(effect.speedBonus)}`, 0, textY + 28);
    ctx.restore();
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

  function drawButtonHint(text, x, y, w, options = {}) {
    const h = options.height || 48;
    const fontSize = options.fontSize || 22;
    ctx.fillStyle = "rgba(31, 42, 51, 0.08)";
    drawRoundedRect(x - w / 2, y - h / 2, w, h, 8);
    ctx.strokeStyle = "rgba(31, 42, 51, 0.16)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - w / 2 + 1, y - h / 2 + 1, w - 2, h - 2);
    ctx.fillStyle = "#24323b";
    ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 1);
  }

  function drawOverlay(title, subtitle, actionText) {
    const touch = isTouchDevice();
    const compactTouch = touch && viewportInfo().orientation === "portrait";
    const display = displaySize();
    const overlayW = display.width;
    const overlayH = display.height;
    const centerX = overlayW / 2;
    const displaySubtitle = compactTouch
      ? (isNetworkGame() ? "敵は上、自分は下。LAN対戦" : "敵は上、自分は下。5ゴールで終了")
      : subtitle;
    const menuLines = isNetworkGame()
      ? touch
        ? [
            "LAN: 先に開いた端末がLEFT、次の端末がRIGHT",
            `現在: ${network.side.toUpperCase()} / ${network.playerCount}人接続`,
            state.lanDuelArmed ? "スマホ接続待ち。入ると自動開始" : "タップでスマホ待ちLAN対戦を選択",
            compactTouch ? "左右ドラッグで移動、下へ引いて溜めショット" : "上下ドラッグで移動、左ドラッグで溜めショット",
          ]
        : [
            "LAN: 先に開いた端末がLEFT、次の端末がRIGHT",
            `現在: ${network.side.toUpperCase()} / ${network.playerCount}人接続`,
            state.lanDuelArmed ? "スマホ接続待ち。入ると自動開始" : "Space/3: スマホ待ちLAN対戦  1: 1人プレイ  2: 同じPC2P",
            "W/S/A または ↑/↓/←、ドラッグでも操作できます",
          ]
      : touch
        ? [
            compactTouch ? "タップで開始、左右ドラッグで移動" : "タップで開始、上下ドラッグで移動",
            compactTouch ? "下へ引いて溜め、戻す/離すとショット" : "左へ引いて溜め、戻す/離すとショット",
            "同じWi-Fi対戦は両端末で開いてタップ開始",
          ]
        : [
            "1P: W/S/A・ドラッグ  2P: ↑/↓/←  P/Enterで一時停止",
            "Space/クリックで1人プレイ  2キーで同じPCの2人対戦",
            "3キーで同じWi-FiのLAN同期対戦",
          ];

    ctx.fillStyle = "rgba(249, 252, 253, 0.84)";
    ctx.fillRect(0, 0, overlayW, overlayH);

    ctx.fillStyle = "#1f2a33";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${compactTouch ? 82 : 78}px Inter, system-ui, sans-serif`;
    ctx.fillText(title, centerX, compactTouch ? 360 : 254);

    ctx.fillStyle = "#49616e";
    ctx.font = `500 ${compactTouch ? 30 : 27}px Inter, system-ui, sans-serif`;
    ctx.fillText(displaySubtitle, centerX, compactTouch ? 466 : 323);

    drawButtonHint(
      actionText,
      centerX,
      compactTouch ? 592 : 405,
      compactTouch ? 520 : 390,
      compactTouch ? { fontSize: 38, height: 74 } : {}
    );

    ctx.fillStyle = "#607580";
    ctx.font = `500 ${compactTouch ? 34 : 19}px Inter, system-ui, sans-serif`;
    menuLines.forEach((line, index) => {
      ctx.fillText(line, centerX, (compactTouch ? 704 : 472) + index * (compactTouch ? 46 : 28));
    });
    if (compactTouch) {
      return;
    }
    ctx.fillStyle = state.easyMode ? "#1c84b4" : "#607580";
    ctx.font = `800 ${compactTouch ? 30 : 18}px Inter, system-ui, sans-serif`;
    ctx.fillText(`E: 簡単モード ${state.easyMode ? "ON" : "OFF"}（LAN対戦開始時はOFF）`, centerX, compactTouch ? 640 : 584);
    ctx.fillStyle = state.trainingMode === "hard" ? "#ef5c43" : state.trainingMode === "training" ? "#1c84b4" : "#607580";
    ctx.fillText(`T: ${trainingModeLabel()} / H: ハード`, centerX, compactTouch ? 672 : 610);
    ctx.fillStyle = state.cursorControlMode ? "#1c84b4" : "#607580";
    ctx.fillText(`C: カーソル追従 ${state.cursorControlMode ? "ON" : "OFF"}`, centerX, compactTouch ? 704 : 636);
  }

  function drawPointNotice() {
    if (state.mode !== "point") return;

    const lastSide = state.lastPoint === "opponent" ? "right" : "left";
    const sideLabel = isMobilePortraitView()
      ? (lastSide === portraitBottomSide() ? "あなたのゴール" : "相手のゴール")
      : state.lastPoint === "player" ? "あなたのゴール" : "相手のゴール";
    const label = `${sideLabel} +${formatScore(state.lastPointAmount)}`;
    const display = displaySize();
    ctx.fillStyle = "rgba(249, 252, 253, 0.72)";
    ctx.fillRect(0, display.height / 2 - 58, display.width, 116);
    ctx.fillStyle = "#1f2a33";
    ctx.font = "800 42px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, display.width / 2, display.height / 2);
  }

  function drawTutorialBubbles() {
    if (!state.tutorial.bubbles.length) return;

    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    state.tutorial.bubbles.forEach((bubble, index) => {
      const alpha = clamp(Math.min(bubble.timer, bubble.duration - bubble.timer) / 0.35, 0, 1);
      const fontSize = 22.5;
      const lineHeight = 30;
      const padX = 20;
      const padY = 16;
      ctx.font = `800 ${fontSize}px Inter, system-ui, sans-serif`;
      const textWidth = bubble.lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0);
      const w = clamp(textWidth + padX * 2, 280, 520);
      const h = bubble.lines.length * lineHeight + padY * 2;
      const stackedY = bubble.y + index * (h + 10);
      let x = bubble.side === "right" ? bubble.x - w : bubble.x;
      if (bubble.side === "center") x = bubble.x - w / 2;
      x = clamp(x, 24, FIELD_W - w - 24);
      const y = clamp(stackedY - h / 2, 56, FIELD_H - h - 92);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(31, 42, 51, 0.92)";
      drawRoundedRect(x, y, w, h, 8);
      ctx.fillStyle = "#f9fcfd";
      bubble.lines.forEach((line, lineIndex) => {
        ctx.fillText(line, x + padX, y + padY + lineHeight / 2 + lineIndex * lineHeight);
      });

      const pointerX = clamp(bubble.x, x + 18, x + w - 18);
      const pointerY = bubble.y < y + h / 2 ? y : y + h;
      ctx.beginPath();
      ctx.moveTo(pointerX - 8, pointerY);
      ctx.lineTo(pointerX + 8, pointerY);
      ctx.lineTo(bubble.x, bubble.y);
      ctx.closePath();
      ctx.fillStyle = "rgba(31, 42, 51, 0.92)";
      ctx.fill();
    });
    ctx.restore();
  }

  function drawHudPanel(paddle, x, y, w, h, label, accent = "#ef5c43", showBall = true) {
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(249, 252, 253, 0.88)";
    drawRoundedRect(x, y, w, h, 8);
    ctx.strokeStyle = "rgba(31, 42, 51, 0.14)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    ctx.fillStyle = "#607580";
    ctx.font = "700 13px Inter, system-ui, sans-serif";
    ctx.fillText(label, x + 16, y + 18);

    ctx.fillStyle = "#1f2a33";
    ctx.font = "800 24px Inter, system-ui, sans-serif";
    ctx.fillText(String(Math.round(Math.abs(paddle.vy))), x + 82, y + 18);

    if (showBall) {
      ctx.fillStyle = "#607580";
      ctx.font = "700 13px Inter, system-ui, sans-serif";
      ctx.fillText("BALL", x + 150, y + 18);

      ctx.fillStyle = "#1f2a33";
      ctx.font = "800 24px Inter, system-ui, sans-serif";
      ctx.fillText(String(currentBallSpeed()), x + 196, y + 18);
    }

    if (isReleaseMode()) {
      ctx.fillStyle = accent;
      ctx.font = "800 13px Inter, system-ui, sans-serif";
      ctx.fillText("RELEASE", x + w - 104, y + 18);

      ctx.fillStyle = "#607580";
      ctx.font = "700 13px Inter, system-ui, sans-serif";
      ctx.fillText(`UP ${Math.round(paddle.upCharge)}`, x + 16, y + 45);
      ctx.fillText(`DOWN ${Math.round(paddle.downCharge)}`, x + 142, y + 45);

      const shotValue = paddle.smashCharge > 0
        ? Math.round(paddle.smashCharge)
        : Math.round(paddle.smashLastCharge);
      ctx.fillStyle = paddle.smashReadyTimer > 0 ? accent : "#607580";
      ctx.font = "800 13px Inter, system-ui, sans-serif";
      ctx.fillText(paddle.smashReadyTimer > 0 ? "SHOT READY" : "SHOT", x + 16, y + 72);
      ctx.fillStyle = "#1f2a33";
      ctx.font = "800 18px Inter, system-ui, sans-serif";
      ctx.fillText(String(shotValue), x + 112, y + 72);
    }

    ctx.restore();
  }

  function drawHud() {
    const releaseActive = isReleaseMode();
    const w = releaseActive ? 390 : 300;
    const h = releaseActive ? 92 : 46;

    if (isMobilePortraitView()) {
      const display = displaySize();
      const label = isNetworkGame()
        ? (network.side === "right" ? "LAN YOU" : network.side === "left" ? "LAN YOU" : "WATCH")
        : "YOU";
      drawHudPanel(
        localPaddle(),
        display.width / 2 - w / 2,
        display.height - (releaseActive ? 246 : 168),
        w,
        h,
        label,
        "#ef5c43",
        true
      );
      return;
    }

    const y = FIELD_H - (releaseActive ? 128 : 82);

    if (isLocalTwoPlayer()) {
      const panelW = 360;
      const gap = 22;
      const leftX = FIELD_W / 2 - panelW - gap / 2;
      const rightX = FIELD_W / 2 + gap / 2;
      drawHudPanel(state.player, leftX, y, panelW, h, "1P", "#1c84b4", false);
      drawHudPanel(state.opponent, rightX, y, panelW, h, "2P", "#ef5c43", true);
      return;
    }

    if (isNetworkGame()) {
      const label = network.side === "right" ? "LAN RIGHT" : network.side === "left" ? "LAN LEFT" : "WATCH";
      const accent = network.side === "right" ? "#ef5c43" : "#1c84b4";
      drawHudPanel(localPaddle(), FIELD_W / 2 - w / 2, y, w, h, label, accent, true);
      return;
    }

    drawHudPanel(localPaddle(), FIELD_W / 2 - w / 2, y, w, h, "PADDLE", "#ef5c43", true);
  }

  function drawVersion() {
    const display = displaySize();
    ctx.save();
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(31, 42, 51, 0.36)";
    ctx.font = "700 13px Inter, system-ui, sans-serif";
    ctx.fillText(GAME_VERSION, display.width - 20, display.height - 14);
    ctx.restore();
  }

  function drawNetworkStatus() {
    let label = "SOLO / LANサーバーなし";
    if (isLocalTwoPlayer()) {
      label = "LOCAL 2P / 同じPCで対戦中";
    } else if (isNetworkGame()) {
      const sideLabel = network.side === "right" ? "RIGHT" : network.side === "left" ? "LEFT" : "WATCH";
      const peerLabel = state.lanDuelActive
        ? (network.playerCount >= 2 ? "同期対戦中" : "相手待ち")
        : state.lanDuelArmed ? "スマホ接続待ち"
          : (network.playerCount >= 2 ? "3でLAN対戦" : "3でスマホ待ち");
      label = `LAN ${sideLabel} / ${peerLabel}`;
    } else if (network.lastError) {
      label = "SOLO / LAN未接続";
    }
    if (state.easyMode) {
      label += " / 簡単ON";
    }
    if (state.cursorControlMode) {
      label += " / カーソルON";
    }
    if (state.trainingMode !== "normal") {
      label += ` / ${trainingModeLabel()}`;
    }

    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(31, 42, 51, 0.44)";
    ctx.font = "700 13px Inter, system-ui, sans-serif";
    ctx.fillText(label, 20, displaySize().height - 14);
    ctx.restore();
  }

  function applyPortraitBoardTransform() {
    if (portraitBottomSide() === "right") {
      ctx.translate(FIELD_H, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(0, FIELD_W);
      ctx.rotate(-Math.PI / 2);
    }
  }

  function drawBoardElements({ portrait = false } = {}) {
    drawField();
    if (!portrait) {
      drawScore();
    }
    drawPaddle(state.player, "#1c84b4", "rgba(28, 132, 180, 0.28)");
    drawPaddle(state.opponent, "#283742", "rgba(40, 55, 66, 0.24)");
    drawBallTrail();
    drawBall();
    if (!portrait) {
      drawCenterHitEffect();
    }
    drawDragGuide();
    if (!portrait) {
      drawSpinNotice();
    }
  }

  function drawOverlays() {
    drawPointNotice();
    if (state.mode !== "menu") {
      drawHud();
    }

    if (state.mode === "menu") {
      const subtitle = isNetworkGame()
        ? "2つの端末でLEFT/RIGHTに分かれて同期対戦します。"
        : "5ゴールで終了。最初から解放モードで勝負します。";
      const touch = isTouchDevice();
      const actionText = touch
        ? (isNetworkGame() ? (state.lanDuelArmed ? "スマホ接続待ち" : "タップ: LAN対戦待機") : "タップ: 開始")
        : (isNetworkGame() ? (state.lanDuelArmed ? "スマホ接続待ち" : "Space / 3: スマホ待ちLAN") : "Space: 1P / 2: 2P / 3: LAN");
      drawOverlay("PING PONG", subtitle, actionText);
    } else if (state.mode === "paused") {
      drawOverlay("PAUSE", "ラリーはここで止まっています。", "P / Enter / Spaceで再開");
    } else if (state.mode === "gameover") {
      const won = state.winner === "player";
      const title = state.winner === "draw" ? "DRAW" : won ? "YOU WIN" : "YOU LOSE";
      drawOverlay(title, `${formatScore(state.player.score)} - ${formatScore(state.opponent.score)}`, "Spaceで再戦");
    }

    if (!isMobilePortraitView()) {
      drawTutorialBubbles();
    }
    drawNetworkStatus();
    drawVersion();
  }

  function render() {
    const display = displaySize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, display.width, display.height);

    if (isMobilePortraitView()) {
      ctx.save();
      applyPortraitBoardTransform();
      drawBoardElements({ portrait: true });
      ctx.restore();
      drawPortraitScore();
      drawOverlays();
      return;
    }

    drawBoardElements();
    drawOverlays();
  }

  function frame(now) {
    const seconds = lastTime ? (now - lastTime) / 1000 : 0;
    lastTime = now;
    update(seconds);
    render();
    rafId = requestAnimationFrame(frame);
  }

  function resizeCanvas() {
    const display = displaySize();
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = Math.round(display.width * dpr);
    canvas.height = Math.round(display.height * dpr);
    canvas.style.aspectRatio = `${display.width} / ${display.height}`;
    if (canvas.parentElement) {
      canvas.parentElement.style.aspectRatio = `${display.width} / ${display.height}`;
    }
    render();
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const display = displaySize();
    const displayX = ((event.clientX - rect.left) / rect.width) * display.width;
    const displayY = ((event.clientY - rect.top) / rect.height) * display.height;

    if (!isMobilePortraitView()) {
      return {
        x: displayX,
        y: displayY,
      };
    }

    if (portraitBottomSide() === "right") {
      return {
        x: clamp(displayY, 0, FIELD_W),
        y: clamp(FIELD_H - displayX, 0, FIELD_H),
      };
    }

    return {
      x: clamp(FIELD_W - displayY, 0, FIELD_W),
      y: clamp(displayX, 0, FIELD_H),
    };
  }

  function showMoveTutorial(side = localInputSide()) {
    const paddle = sideToPaddle(side);
    showTutorial(
      "move",
      ["長押し/上下ドラッグで加速"],
      paddle === state.opponent ? paddle.x - 46 : paddle.x + paddle.w + 46,
      paddle.y + paddle.h / 2,
      paddle === state.opponent ? "right" : "left"
    );
  }

  function showSmashTutorial(side = localInputSide()) {
    const paddle = sideToPaddle(side);
    showTutorial(
      "smash",
      ["溜め中は球を通す", "上下加速で回転ため"],
      paddle === state.opponent ? paddle.x - 52 : paddle.x + paddle.w + 52,
      paddle.y + paddle.h / 2 + 52,
      paddle === state.opponent ? "right" : "left"
    );
  }

  function showChargeTutorialIfNeeded(side = localInputSide()) {
    if (!isReleaseMode()) return;

    const input = inputForSide(side);
    if (!input.up || !input.down) return;

    const paddle = sideToPaddle(side);

    showTutorial(
      "charge",
      ["上下同時で速度溜め", "片方を離すと反対へ発射"],
      paddle === state.opponent ? paddle.x - 42 : paddle.x + paddle.w + 42,
      paddle.y + paddle.h / 2,
      paddle === state.opponent ? "right" : "left"
    );
  }

  function startDragControl(event) {
    const point = canvasPoint(event);
    cursorY = point.y;
    pointerY = point.y;
    dragControl = {
      active: true,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      x: point.x,
      y: point.y,
      moveIntent: 0,
    };
  }

  function updateDragControl(event) {
    if (!dragControl.active || dragControl.pointerId !== event.pointerId) return;

    const wasSmashPressed = isSmashPressed();
    const previousMoveIntent = dragControl.moveIntent;
    const side = localInputSide();
    const point = canvasPoint(event);
    cursorY = point.y;
    pointerY = point.y;
    dragControl.x = point.x;
    dragControl.y = point.y;

    const drag = dragInput();
    dragControl.moveIntent = drag.moveIntent;

    if (drag.moveIntent !== 0 && previousMoveIntent === 0 && (state.mode === "playing" || state.mode === "point")) {
      showMoveTutorial(side);
    }
    showChargeTutorialIfNeeded(side);
    if (!wasSmashPressed && isSmashPressed()) {
      showSmashTutorial(side);
    }
    if (wasSmashPressed && !isSmashPressed()) {
      armSmashRelease();
    }
  }

  function updateCursorPosition(event) {
    const point = canvasPoint(event);
    cursorY = point.y;
  }

  function endDragControl(event) {
    if (!dragControl.active || dragControl.pointerId !== event.pointerId) return;

    const wasSmashPressed = isSmashPressed();
    resetDragControl();
    if (wasSmashPressed && !isSmashPressed()) {
      armSmashRelease();
    }
  }

  function togglePause() {
    if (isNetworkGame() && !network.host) {
      sendNetworkControl("pause-toggle");
      return;
    }

    if (state.mode === "playing") {
      state.mode = "paused";
      forceNetworkSnapshot();
    } else if (state.mode === "paused") {
      state.mode = "playing";
      lastTime = performance.now();
      forceNetworkSnapshot();
    }
  }

  function handleStartResume() {
    resumeAudio();

    if (isNetworkGame() && state.mode === "menu") {
      startLanDuelGame();
      return;
    }

    if (isNetworkGame() && !network.host) {
      sendNetworkControl("start");
      return;
    }

    if (state.mode === "menu") {
      startGame({ localTwoPlayer: false });
    } else if (state.mode === "gameover") {
      if (isNetworkGame()) {
        startLanDuelGame();
      } else {
        startGame({ localTwoPlayer: isLocalTwoPlayer() });
      }
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

  function sendNetworkMessage(message) {
    if (!network.socket || network.socket.readyState !== WebSocket.OPEN) return false;
    network.socket.send(JSON.stringify(message));
    return true;
  }

  function sendNetworkControl(action) {
    sendNetworkMessage({ type: "control", action });
  }

  function syncNetworkInput() {
    if (!isNetworkGame() || network.side === "spectator") return;

    const now = performance.now();
    if (now - network.lastInputAt < 30) return;
    network.lastInputAt = now;
    sendNetworkMessage({ type: "input", input: localControlInput(network.side) });
  }

  function copyPaddle(paddle) {
    return {
      x: paddle.x,
      y: paddle.y,
      w: paddle.w,
      h: paddle.h,
      score: paddle.score,
      vy: paddle.vy,
      upCharge: paddle.upCharge,
      downCharge: paddle.downCharge,
      smashCharge: paddle.smashCharge,
      smashReadyTimer: paddle.smashReadyTimer,
      smashLastCharge: paddle.smashLastCharge,
      smashLastSpeedBonus: paddle.smashLastSpeedBonus,
      smashStoredSpinVelocity: paddle.smashStoredSpinVelocity,
      smashReleaseSpinVelocity: paddle.smashReleaseSpinVelocity,
      smashPressedLastFrame: paddle.smashPressedLastFrame,
      releaseShakePhase: paddle.releaseShakePhase,
      releaseShakePower: paddle.releaseShakePower,
      releaseHeldVelocity: paddle.releaseHeldVelocity,
    };
  }

  function applyPaddleSnapshot(paddle, snapshot) {
    Object.assign(paddle, snapshot);
  }

  function createNetworkSnapshot() {
    return {
      mode: state.mode,
      pointTimer: state.pointTimer,
      lastPoint: state.lastPoint,
      lastPointAmount: state.lastPointAmount,
      lastScoreReason: state.lastScoreReason,
      winner: state.winner,
      lanDuelArmed: state.lanDuelArmed,
      lanDuelActive: state.lanDuelActive,
      easyMode: state.easyMode,
      cursorControlMode: state.cursorControlMode,
      trainingMode: state.trainingMode,
      rally: state.rally,
      goals: { ...state.goals },
      player: copyPaddle(state.player),
      opponent: copyPaddle(state.opponent),
      ball: {
        ...state.ball,
        trail: state.ball.trail.slice(-32),
      },
      spinNotice: { ...state.spinNotice },
      centerHitEffect: { ...state.centerHitEffect },
    };
  }

  function applyNetworkSnapshot(snapshot) {
    state.mode = snapshot.mode;
    state.pointTimer = snapshot.pointTimer;
    state.lastPoint = snapshot.lastPoint;
    state.lastPointAmount = snapshot.lastPointAmount;
    state.lastScoreReason = snapshot.lastScoreReason;
    state.winner = snapshot.winner;
    state.lanDuelArmed = Boolean(snapshot.lanDuelArmed);
    state.lanDuelActive = Boolean(snapshot.lanDuelActive);
    state.easyMode = Boolean(snapshot.easyMode);
    state.cursorControlMode = Boolean(snapshot.cursorControlMode);
    state.trainingMode = snapshot.trainingMode || "normal";
    state.rally = snapshot.rally;
    state.goals = { ...snapshot.goals };
    applyPaddleSnapshot(state.player, snapshot.player);
    applyPaddleSnapshot(state.opponent, snapshot.opponent);
    state.ball = {
      ...snapshot.ball,
      trail: Array.isArray(snapshot.ball.trail) ? snapshot.ball.trail : [],
    };
    state.spinNotice = { ...snapshot.spinNotice };
    state.centerHitEffect = snapshot.centerHitEffect
      ? { ...snapshot.centerHitEffect }
      : { ...state.centerHitEffect, timer: 0 };
  }

  function syncNetworkSnapshot() {
    if (!isNetworkHost()) return;

    const now = performance.now();
    if (now - network.lastSnapshotAt < 45) return;
    network.lastSnapshotAt = now;
    sendNetworkMessage({ type: "snapshot", snapshot: createNetworkSnapshot() });
  }

  function forceNetworkSnapshot() {
    if (!isNetworkHost()) return;

    network.lastSnapshotAt = -Infinity;
    syncNetworkSnapshot();
  }

  function handleNetworkMessage(message) {
    if (message.type === "welcome") {
      network.connected = true;
      network.side = message.side;
      network.host = Boolean(message.host);
      network.clients = message.clients || [];
      network.playerCount = networkPlayerCount();
      network.urls = message.urls || [];
      network.lastError = null;
      maybeAutoStartArmedLanDuel();
      return;
    }

    if (message.type === "peers") {
      network.clients = message.clients || [];
      network.playerCount = networkPlayerCount();
      maybeAutoStartArmedLanDuel();
      return;
    }

    if (message.type === "input" && message.side) {
      network.remoteInputs[message.side] = {
        up: Boolean(message.input && message.input.up),
        down: Boolean(message.input && message.input.down),
        smash: Boolean(message.input && message.input.smash),
      };
      return;
    }

    if (message.type === "snapshot" && !network.host && message.snapshot) {
      applyNetworkSnapshot(message.snapshot);
      return;
    }

    if (message.type === "control" && network.host) {
      if (message.action === "start") {
        handleStartResume();
      } else if (message.action === "start-lan-duel") {
        startLanDuelGame();
      } else if (message.action === "restart-lan-duel") {
        startLanDuelGame();
      } else if (message.action === "pause-toggle") {
        togglePause();
      }
    }
  }

  function connectNetwork() {
    if (!("WebSocket" in window) || !window.location.host || window.location.protocol === "file:" || !("fetch" in window)) return;

    fetch("/lan-info.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("LAN server unavailable");
        return response.json();
      })
      .then((info) => {
        if (!info.enabled) throw new Error("LAN server unavailable");
        network.urls = info.urls || [];
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
        network.socket = socket;

        socket.addEventListener("message", (event) => {
          try {
            handleNetworkMessage(JSON.parse(event.data));
          } catch (error) {
            network.lastError = error.message;
          }
        });

        socket.addEventListener("open", () => {
          network.lastError = null;
        });

        socket.addEventListener("close", () => {
          network.connected = false;
          network.side = "solo";
          network.host = false;
          network.playerCount = 0;
        });

        socket.addEventListener("error", () => {
          network.lastError = "LAN server unavailable";
        });
      })
      .catch(() => {
        network.lastError = "LAN server unavailable";
      });
  }

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    resumeAudio();
    canvas.setPointerCapture(event.pointerId);
    handleStartResume();
    startDragControl(event);
  });

  canvas.addEventListener("pointermove", (event) => {
    event.preventDefault();
    updateCursorPosition(event);
    updateDragControl(event);
  });

  canvas.addEventListener("pointerup", (event) => {
    event.preventDefault();
    endDragControl(event);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  });

  canvas.addEventListener("pointercancel", (event) => {
    endDragControl(event);
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  window.addEventListener("keydown", (event) => {
    const wasPressed = keys.has(event.code);
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
      if (isNetworkGame()) {
        if (network.host) {
          startLanDuelGame();
        } else {
          sendNetworkControl("restart-lan-duel");
        }
      } else {
        startGame({ localTwoPlayer: isLocalTwoPlayer() });
      }
    } else if (event.code === "KeyE") {
      event.preventDefault();
      state.easyMode = !state.easyMode;
    } else if (event.code === "KeyC") {
      event.preventDefault();
      state.cursorControlMode = !state.cursorControlMode;
    } else if (event.code === "KeyT") {
      event.preventDefault();
      cycleTrainingMode();
    } else if (event.code === "KeyH") {
      event.preventDefault();
      state.trainingMode = "hard";
    } else if (event.code === "Digit2") {
      event.preventDefault();
      startLocalTwoPlayerGame();
    } else if (event.code === "Digit3") {
      event.preventDefault();
      startLanDuelGame();
    } else if (event.code === "Digit1") {
      event.preventDefault();
      startGame({ localTwoPlayer: false });
    } else if (event.code === "KeyF") {
      toggleFullscreen();
    }

    if (!wasPressed && isMoveKey(event.code) && (state.mode === "playing" || state.mode === "point")) {
      const side = sideForKey(event.code);
      showMoveTutorial(side);
      showChargeTutorialIfNeeded(side);
    }

    if (!wasPressed && isSmashKey(event.code) && (state.mode === "playing" || state.mode === "point")) {
      showSmashTutorial(sideForKey(event.code));
    }
  });

  window.addEventListener("keyup", (event) => {
    const wasLeftSmashPressed = inputForSide("left").smash;
    const wasRightSmashPressed = inputForSide("right").smash;
    const wasSmashPressed = isSmashPressed();
    keys.delete(event.code);
    const stillLeftSmashPressed = inputForSide("left").smash;
    const stillRightSmashPressed = inputForSide("right").smash;
    const stillSmashPressed = isSmashPressed();

    if (isLocalTwoPlayer() && isSmashKey(event.code) && (state.mode === "playing" || state.mode === "point")) {
      if (wasLeftSmashPressed && !stillLeftSmashPressed) {
        armSmashReleaseForPaddle(state.player);
      }
      if (wasRightSmashPressed && !stillRightSmashPressed) {
        armSmashReleaseForPaddle(state.opponent);
      }
      return;
    }

    if (
      isSmashKey(event.code) &&
      wasSmashPressed &&
      !stillSmashPressed &&
      (state.mode === "playing" || state.mode === "point")
    ) {
      armSmashRelease();
    }
  });

  window.addEventListener("blur", () => {
    keys.clear();
    resetSmashCharge();
    resetDragControl();
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
    const drag = dragInput();
    const payload = {
      coordinateSystem: "origin top-left, x right, y down, logical canvas 1280x720",
      version: GAME_VERSION,
      viewport: viewportInfo(),
      mode: state.mode,
      playMode: isLocalTwoPlayer()
        ? "local-two-player"
        : isNetworkGame()
          ? (state.lanDuelActive ? "lan-duel" : state.lanDuelArmed ? "lan-waiting" : "lan-lobby")
          : "solo",
      localTwoPlayer: state.localTwoPlayer,
      lanDuelArmed: state.lanDuelArmed,
      lanDuelActive: state.lanDuelActive,
      easyMode: {
        active: state.easyMode,
        assistedSide: state.easyMode ? "left" : null,
        playerAlignedToBall: state.easyMode
          ? Math.round(rectCenterY(state.player)) === Math.round(state.ball.y)
          : false,
      },
      cursorControlMode: {
        active: state.cursorControlMode,
        cursorY: cursorY === null ? null : Math.round(cursorY),
        playerAlignedToCursor: state.cursorControlMode && cursorY !== null
          ? Math.round(rectCenterY(state.player)) === Math.round(cursorY)
          : false,
      },
      trainingMode: {
        mode: state.trainingMode,
        label: trainingModeLabel(),
        opponentGuaranteedReturn: isTrainingOpponent(),
        hard: state.trainingMode === "hard",
      },
      score: {
        player: round2(state.player.score),
        opponent: round2(state.opponent.score),
        playerDisplay: formatScore(state.player.score),
        opponentDisplay: formatScore(state.opponent.score),
        targetGoals: GOALS_TO_END,
      },
      goals: {
        player: state.goals.player,
        opponent: state.goals.opponent,
        total: state.goals.total,
        target: GOALS_TO_END,
      },
      player: {
        x: Math.round(state.player.x),
        y: Math.round(state.player.y),
        width: state.player.w,
        height: state.player.h,
        velocityY: Math.round(state.player.vy),
        currentSpeed: Math.round(Math.abs(state.player.vy)),
        upCharge: Math.round(state.player.upCharge),
        downCharge: Math.round(state.player.downCharge),
        smashCharge: Math.round(state.player.smashCharge),
        smashReady: state.player.smashReadyTimer > 0,
        smashReadyTimer: round2(state.player.smashReadyTimer),
        smashLastCharge: Math.round(state.player.smashLastCharge),
        smashLastSpeedBonus: Math.round(state.player.smashLastSpeedBonus),
        smashStoredSpinVelocity: Math.round(state.player.smashStoredSpinVelocity),
        smashReleaseSpinVelocity: Math.round(state.player.smashReleaseSpinVelocity),
        releaseShakePower: Math.round(state.player.releaseShakePower),
        releaseHeldVelocity: Math.round(state.player.releaseHeldVelocity),
      },
      opponent: {
        x: Math.round(state.opponent.x),
        y: Math.round(state.opponent.y),
        width: state.opponent.w,
        height: state.opponent.h,
        velocityY: Math.round(state.opponent.vy),
        currentSpeed: Math.round(Math.abs(state.opponent.vy)),
        upCharge: Math.round(state.opponent.upCharge),
        downCharge: Math.round(state.opponent.downCharge),
        smashCharge: Math.round(state.opponent.smashCharge),
        smashReady: state.opponent.smashReadyTimer > 0,
        smashReadyTimer: round2(state.opponent.smashReadyTimer),
        smashLastCharge: Math.round(state.opponent.smashLastCharge),
        smashLastSpeedBonus: Math.round(state.opponent.smashLastSpeedBonus),
        smashStoredSpinVelocity: Math.round(state.opponent.smashStoredSpinVelocity),
        smashReleaseSpinVelocity: Math.round(state.opponent.smashReleaseSpinVelocity),
        releaseShakePower: Math.round(state.opponent.releaseShakePower),
        releaseHeldVelocity: Math.round(state.opponent.releaseHeldVelocity),
      },
      ball: {
        x: Math.round(state.ball.x),
        y: Math.round(state.ball.y),
        radius: state.ball.r,
        velocityX: Math.round(state.ball.vx),
        velocityY: Math.round(state.ball.vy),
        speed: Math.round(state.ball.speed),
        currentSpeed: currentBallSpeed(),
        baseSpeed: BALL_BASE_SPEED,
        rallySpeedGain: RALLY_BALL_SPEED_GAIN,
        centerHitMaxSpeedBonus: CENTER_HIT_SPEED_BONUS,
        centerHitEffectThreshold: CENTER_HIT_EFFECT_THRESHOLD,
        lastCenterHitFactor: round2(state.ball.lastCenterHitFactor),
        lastCenterHitSpeedBonus: Math.round(state.ball.lastCenterHitSpeedBonus),
        smashChargeAccel: SMASH_CHARGE_ACCEL,
        smashSpeedBonusScale: SMASH_SPEED_BONUS_SCALE,
        smashReleaseWindow: SMASH_RELEASE_WINDOW,
        lastSmashCharge: Math.round(state.ball.lastSmashCharge),
        lastSmashSpeedBonus: Math.round(state.ball.lastSmashSpeedBonus),
        lastSpinVelocity: Math.round(state.ball.lastSpinVelocity),
        playerSmashSpeedBonus: Math.round(state.ball.playerSmashSpeedBonus),
        opponentSmashSpeedBonus: Math.round(state.ball.opponentSmashSpeedBonus),
        lastGoalProtectedSpeed: Math.round(state.ball.lastGoalProtectedSpeed),
        lastGoalSpeedScore: round2(state.ball.lastGoalSpeedScore),
        maxSpeed: BALL_MAX_SPEED,
        spinUnlimited: true,
        spinScoreReference: SPIN_SCORE_REFERENCE,
        spinReferenceSpeed: SPIN_REFERENCE_SPEED,
        spin: round2(state.ball.spin),
        curveStrength: round2(state.ball.curveStrength),
        curveBoostThreshold: SPIN_CURVE_BOOST_THRESHOLD,
        verticalLimit: Math.round(ballVerticalLimit()),
        arcDirection: state.ball.arcDirection,
        trailPoints: state.ball.trail.length,
      },
      rally: state.rally,
      releaseMode: {
        active: isReleaseMode(),
        threshold: RELEASE_RALLY_THRESHOLD,
        upCharge: Math.round(localPaddle().upCharge),
        downCharge: Math.round(localPaddle().downCharge),
        shakeActive: localPaddle().releaseShakePower > 0,
        shakePower: Math.round(localPaddle().releaseShakePower),
        heldVelocity: Math.round(localPaddle().releaseHeldVelocity),
      },
      smashMode: {
        charging: isSmashPressed(),
        charge: Math.round(state.player.smashCharge),
        ready: state.player.smashReadyTimer > 0,
        readyTimer: round2(state.player.smashReadyTimer),
        lastCharge: Math.round(state.player.smashLastCharge),
        lastSpeedBonus: Math.round(state.player.smashLastSpeedBonus),
        storedSpinVelocity: Math.round(state.player.smashStoredSpinVelocity),
        releaseSpinVelocity: Math.round(state.player.smashReleaseSpinVelocity),
        releaseWindow: SMASH_RELEASE_WINDOW,
      },
      dragControl: {
        active: dragControl.active,
        dx: Math.round(drag.dx),
        dy: Math.round(drag.dy),
        moveIntent: drag.moveIntent,
        up: drag.up,
        down: drag.down,
        smash: drag.smash,
        moveDeadzone: DRAG_MOVE_DEADZONE,
        smashDeadzone: DRAG_SMASH_DEADZONE,
      },
      network: {
        connected: network.connected,
        side: network.side,
        host: network.host,
        playerCount: network.playerCount,
        canStartLanDuel: canStartLanDuel(),
        lanDuelArmed: state.lanDuelArmed,
        lanDuelActive: state.lanDuelActive,
        clients: network.clients,
        urls: network.urls,
        lastError: network.lastError,
      },
      tutorial: {
        active: state.tutorial.bubbles.length > 0,
        activeIds: state.tutorial.bubbles.map((bubble) => bubble.id),
        seenIds: Object.keys(state.tutorial.seen),
      },
      lastPoint: state.lastPoint,
      lastPointAmount: round2(state.lastPointAmount),
      lastScoreReason: state.lastScoreReason,
      spinNotice: {
        active: state.spinNotice.timer > 0,
        side: state.spinNotice.side,
        amount: round2(state.spinNotice.amount),
      },
      centerHitEffect: {
        active: state.centerHitEffect.timer > 0,
        side: state.centerHitEffect.side,
        factor: round2(state.centerHitEffect.factor),
        speedBonus: Math.round(state.centerHitEffect.speedBonus),
        timer: round2(state.centerHitEffect.timer),
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

  connectNetwork();
  resizeCanvas();
  rafId = requestAnimationFrame(frame);

  window.addEventListener("beforeunload", () => {
    cancelAnimationFrame(rafId);
  });
})();
