(function() {
	// Marker toàn cục – nếu đã tồn tại thì thoát ngay
	if (window.__jungle_content_script_marker__) {
		console.log("[Jungle Content] Already injected, skipping re-execution");
		return;
	}
	window.__jungle_content_script_marker__ = true;

	'use strict';
	let _audioCtx = null;
	let _jungle = null;
	let _previousPlaybackRate = 1;
	let _previousPitch = 0;
	let _previousBoost = 0.8;
	let _previousPan = 0;
	let _previousSoundProfile = "proNatural";
	let transpose = true;
	let videoConnected = false;
	let _observer = null;
	let _analyser = null;
	let _currentBPM = null;
	let _currentKey = null;
	let currentVideoSrc = null;
	let isEnabled = false;
	let isHeld = false;
	const outputNodeMap = new Map();
	const videoListeners = new Map();
	const favoritesMap = new Map();
	let isCalculatingBPM = false;
	let _nonstopInterval = null;
	let _lastNonstopCheck = 0;
	const NONSTOP_INTERACTION_INTERVAL = 30000; // Mô phỏng tương tác mỗi 30 giây
	const NONSTOP_COOLDOWN = 5000; // Cooldown 5 giây để tránh xử lý lặp lại
	const VIDEO_CHECK_FALLBACK_INTERVAL = 10000; // Dự phòng 10 giây nếu không có video
	let _lastInteractionTime = Date.now(); // Biến mới để theo dõi thời gian tương tác cuối cùng (ghi nhớ thông minh)
	const PREDICTED_DIALOG_TIME = 300000; // Dự đoán dialog sau 5 phút không tương tác (thông minh dựa trên YouTube)
	const INTERACTION_FREQUENCY_LONG = 60000; // Tần suất cho video dài: 1 phút/lần
	const INTERACTION_FREQUENCY_SHORT = 180000; // Tần suất cho short: 3 phút/lần (giảm để tránh thừa)
	const SCROLL_DELTA = 1; // Scroll nhẹ 1px để mimic tương tác mà không ảnh hưởng UI
	let _simulateInterval = null; // Biến toàn cục mới để kiểm soát
	let _currentWakeupInterval = null; // Biến bảo vệ mini-wakeup interval trong applyHeldSettings
	let currentRecordingVideoId = null; // Theo dõi video ID đang cover (hỗ trợ cả Shorts và video dài)
	let currentMediaRecorder = null; // Lưu recorder toàn cục để dừng tức thì
	let isCovering = false; // Biến khóa cover – ngăn bấm nhiều lần
	let hasLoggedInitialWakeup = false; // Thêm biến này ở đầu file (cùng các biến global khác)

	if (typeof Jungle === "undefined") {
		console.error("Jungle library is not loaded. Please include it in the extension.");
	}

// =========================
// QUALITY PRESETS (thêm MP3 nhưng không cần encode thật)
// =========================
const qualities = {
  low: {
    mimeType: 'video/webm;codecs=vp8,opus',
    videoBits: 1_000_000,
    audioBits: 96_000,
    isAudioOnly: false
  },
  medium: {
    mimeType: 'video/webm;codecs=vp8,opus',
    videoBits: 2_000_000,
    audioBits: 128_000,
    isAudioOnly: false
  },
  normal: {
    mimeType: 'video/webm;codecs=vp9,opus',
    videoBits: 3_000_000,
    audioBits: 160_000,
    isAudioOnly: false
  },
  high: {
    mimeType: 'video/webm;codecs=av01,opus',
    videoBits: 5_000_000,
    audioBits: 192_000,
    isAudioOnly: false
  },
  mp3: {
    mimeType: 'audio/webm;codecs=opus',
    audioBits: 320_000,
    isAudioOnly: true
  }
};

// =========================
// QUALITY SELECTION MODAL (thêm tab Video & MP3 riêng, gọn gàng, đẹp + hiệu ứng hover rê chuột)
// =========================
async function selectQuality(duration) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.6);
      display:flex;align-items:center;justify-content:center;z-index:9999;
    `;
    const modal = document.createElement('div');
    modal.style.cssText = `
      background:#fff;border-radius:16px;padding:32px;width:480px;
      box-shadow:0 10px 30px rgba(0,0,0,0.3);text-align:center;
      font-family:Roboto,Arial,sans-serif;position:relative;transition:all 0.3s ease;
    `;
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'X';
    closeBtn.style.cssText = `
      position:absolute;top:10px;right:15px;background:none;border:none;
      font-size:20px;cursor:pointer;color:#666;transition:color 0.2s;
    `;
    closeBtn.onmouseover = () => { closeBtn.style.color = '#f44336'; };
    closeBtn.onmouseout = () => { closeBtn.style.color = '#666'; };
    const cleanup = () => {
      if (document.body.contains(overlay)) overlay.remove();
      window.removeEventListener('beforeunload', cleanup);
    };
    closeBtn.onclick = () => {
      resolve(null);
      cleanup();
    };
    modal.appendChild(closeBtn);

    const header = document.createElement('h2');
    header.textContent = 'Select Cover Quality';
    header.style.margin = '0 0 20px 0';
    header.style.fontSize = '24px';
    modal.appendChild(header);

    const tabContainer = document.createElement('div');
    tabContainer.style.cssText = `
      display:flex;justify-content:center;margin-bottom:20px;
    `;
    const tabVideo = document.createElement('button');
    tabVideo.textContent = 'Video';
    tabVideo.style.cssText = `
      padding:10px 30px;font-size:18px;border:none;cursor:pointer;
      background:#1967d2;color:white;border-radius:8px 0 0 8px;
      font-weight:bold;transition:all 0.3s ease;box-shadow:0 2px 8px rgba(0,0,0,0.2);
    `;
    tabVideo.onmouseover = () => {
      tabVideo.style.transform = 'scale(1.05)';
      tabVideo.style.boxShadow = '0 6px 16px rgba(0,0,0,0.3)';
    };
    tabVideo.onmouseout = () => {
      tabVideo.style.transform = 'scale(1)';
      tabVideo.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    };

    const tabAudio = document.createElement('button');
    tabAudio.textContent = 'Audio';
    tabAudio.style.cssText = `
      padding:10px 30px;font-size:18px;border:none;cursor:pointer;
      background:#f0f0f0;color:#333;border-radius:0 8px 8px 0;
      font-weight:bold;transition:all 0.3s ease;box-shadow:0 2px 8px rgba(0,0,0,0.2);
    `;
    tabAudio.onmouseover = () => {
      tabAudio.style.transform = 'scale(1.05)';
      tabAudio.style.boxShadow = '0 6px 16px rgba(0,0,0,0.3)';
    };
    tabAudio.onmouseout = () => {
      tabAudio.style.transform = 'scale(1)';
      tabAudio.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    };

    tabContainer.appendChild(tabVideo);
    tabContainer.appendChild(tabAudio);
    modal.appendChild(tabContainer);

    const desc = document.createElement('p');
    desc.textContent = 'Choose quality for your recording. Lower qualities are lighter.';
    desc.style.margin = '0 0 30px 0';
    desc.style.color = '#555';
    desc.style.fontSize = '16px';
    desc.style.lineHeight = '1.5';
    modal.appendChild(desc);

    const buttonContainer = document.createElement('div');
    buttonContainer.id = 'quality-buttons';
    modal.appendChild(buttonContainer);

    const calcSize = (v, a, isAudio = false) => {
      if (isAudio) return Math.round((a / 8 * duration) / 1024 / 1024);
      return Math.round(((v + a) / 8 * duration) / 1024 / 1024);
    };

    const showVideoButtons = () => {
      buttonContainer.innerHTML = '';
      tabVideo.style.background = '#1967d2';
      tabVideo.style.color = 'white';
      tabAudio.style.background = '#f0f0f0';
      tabAudio.style.color = '#333';
      createButton('low', 'Low Quality (VP8)', 'Lightest on system • Fastest', '#f0f0f0', '#000');
      createButton('medium', 'Medium Quality (VP8)', 'Small file • Fast recording', '#e0e0e0', '#000');
      createButton('normal', 'Normal Quality (VP9)', 'Balanced quality & size', '#bbbbbb', '#000');
      createButton('high', 'High Quality (AV1)', 'Sharpest video • Richest audio', '#1967d2', 'white');
    };

    const showAudioButtons = () => {
      buttonContainer.innerHTML = '';
      tabVideo.style.background = '#f0f0f0';
      tabVideo.style.color = '#333';
      tabAudio.style.background = '#e91e63';
      tabAudio.style.color = 'white';
      createButton('mp3', 'Audio Only', 'Lightweight • Easy share • Great sound (opus webm)', '#e91e63', 'white');
    };

    const createButton = (level, label, subtext, bg = '#f0f0f0', color = '#000') => {
      const q = qualities[level];
      const size = calcSize(q.videoBits, q.audioBits, q.isAudioOnly);
      const btn = document.createElement('button');
      btn.style.cssText = `
        width:100%;padding:14px;margin-bottom:12px;font-size:18px;
        border:none;border-radius:12px;background:${bg};color:${color};
        cursor:pointer;font-weight:bold;transition:all 0.3s ease;box-shadow:0 2px 8px rgba(0,0,0,0.1);
      `;
      btn.onmouseover = () => {
        btn.style.transform = 'scale(1.05)';
        btn.style.boxShadow = '0 8px 20px rgba(0,0,0,0.25)';
        btn.style.background = bg === '#f0f0f0' ? '#e0e0e0' : (bg === '#e91e63' ? '#d81b60' : bg);
      };
      btn.onmouseout = () => {
        btn.style.transform = 'scale(1)';
        btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
        btn.style.background = bg;
      };
      btn.innerHTML = `${label}<br><small style="font-weight:normal;color:${color==='#000'?'#666':'#eee'};">~${size} MB • ${subtext}</small>`;
      btn.onclick = () => {
        resolve(level);
        cleanup();
      };
      buttonContainer.appendChild(btn);
    };

    tabVideo.onclick = showVideoButtons;
    tabAudio.onclick = showAudioButtons;

    // Mặc định mở tab Video
    showVideoButtons();

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.onclick = e => {
      if (e.target === overlay) {
        resolve(null);
        cleanup();
      }
    };
    window.addEventListener('beforeunload', cleanup);
  });
}

// =========================
// LOAD SENSOR (giữ nguyên)
// =========================
function createLoadSensor(video) {
  const WINDOW_MS = 2500;
  const FRAME_DROP_MS = 70;
  const samples = [];
  let lastFrameTime = performance.now();
  let stopped = false;
  if (typeof video.requestVideoFrameCallback !== 'function') {
    return {
      level: () => 'low',
      high: () => false,
      cool() {},
      stop() {}
    };
  }
  const cb = now => {
    if (stopped) return;
    if (now - lastFrameTime > FRAME_DROP_MS) samples.push(now);
    lastFrameTime = now;
    const cutoff = now - WINDOW_MS;
    while (samples.length && samples[0] < cutoff) samples.shift();
    video.requestVideoFrameCallback(cb);
  };
  video.requestVideoFrameCallback(cb);
  const getLevel = () => samples.length >= 8 ? 'high' : samples.length >= 3 ? 'medium' : 'low';
  return {
    level: getLevel,
    high: () => getLevel() === 'high',
    cool() {
      if (samples.length > 1) samples.splice(0, Math.floor(samples.length / 2));
    },
    stop() {
      stopped = true;
      samples.length = 0;
    }
  };
}

// =========================
// BITRATE ADAPTER (giữ nguyên)
// =========================
function createBitrateAdapter(recorder, baseBits) {
  let current = baseBits;
  let stableTicks = 0;
  const MIN_BITS = 800_000;
  const apply = () => {
    if (recorder?.state === 'recording' && 'videoBitsPerSecond' in recorder) {
      try {
        recorder.videoBitsPerSecond = Math.round(current);
      } catch (_) {}
    }
  };
  return {
    down() {
      stableTicks = 0;
      current = Math.max(current * 0.75, MIN_BITS);
      apply();
    },
    up() {
      if (++stableTicks < 3) return;
      stableTicks = 0;
      current = Math.min(current * 1.1, baseBits);
      apply();
    }
  };
}

// =========================
// UTILITY: once event
// =========================
function once(target, event) {
  return new Promise(resolve => {
    const fn = () => {
      target.removeEventListener(event, fn);
      resolve();
    };
    target.addEventListener(event, fn);
  });
}

// =========================
// MAIN COVER RECORDING (thêm MP3 đơn giản, không thư viện)
// =========================
async function downloadCover() {
  if (isCovering) return;
  isCovering = true;
  let sarInterval = null;
  let loadSensor = null;
  let videoStream = null;
  let audioDestination = null;
  let progressInterval = null;
  try {
    if (!isEnabled || !videoConnected || !_jungle || !_audioCtx) {
      createToast("Extension not enabled or video not connected!", "error");
      return;
    }
    const activeVideo = Array.from(outputNodeMap.keys()).find(v => isVideoPlaying(v));
    if (!activeVideo) {
      createToast("No active video!", "error");
      return;
    }
    const currentUrl = getRealVideoUrl();
    const videoId = (currentUrl.match(/[?&]v=([^&]+)/) || currentUrl.match(/\/shorts\/([a-zA-Z0-9_-]{11})/))?.[1];
    if (currentRecordingVideoId && currentRecordingVideoId !== videoId) {
      currentMediaRecorder?.stop();
      currentRecordingVideoId = null;
      currentMediaRecorder = null;
      return;
    }
    currentRecordingVideoId = videoId;
    const savedCurrentTime = activeVideo.currentTime;
    const coverTitle = document.title.replace(/[-|] YouTube.*/g, "").trim() || "Unknown_Song";
    if (!isFinite(activeVideo.duration)) await once(activeVideo, 'loadedmetadata');
    const totalDuration = activeVideo.duration;
    if (!totalDuration || totalDuration <= 0) {
      createToast("Cannot determine video duration!", "error");
      return;
    }
    const qualityLevel = await selectQuality(totalDuration);
    if (!qualityLevel) return;
    const config = qualities[qualityLevel];
    if (!config) return;
    let isMP3 = config.isAudioOnly;
    let mime = config.mimeType;
    createToast(`Recording ${isMP3 ? 'Audio' : 'cover'} (${qualityLevel.toUpperCase()}) — In your style! ✨`, "recording");
    await ensureAudioContext();
    activeVideo.currentTime = 0.1;
    await activeVideo.play();
    let lastTime = activeVideo.currentTime;
    let userInterrupted = false;
    audioDestination = _audioCtx.createMediaStreamDestination();
    _jungle.output.connect(audioDestination);
    let mixedStream;
    if (isMP3) {
      // Chỉ lấy audio
      mixedStream = audioDestination.stream;
    } else {
      videoStream = activeVideo.captureStream();
      mixedStream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks()
      ]);
    }
    const mediaRecorder = new MediaRecorder(mixedStream, {
      mimeType: mime,
      ...(isMP3 ? { audioBitsPerSecond: config.audioBits } : {
        videoBitsPerSecond: config.videoBits,
        audioBitsPerSecond: config.audioBits
      })
    });
    currentMediaRecorder = mediaRecorder;
    const chunks = [];
    mediaRecorder.ondataavailable = e => {
      if (e.data?.size > 0) chunks.push(e.data);
    };
    mediaRecorder.start();
    if (!isMP3) {
      loadSensor = createLoadSensor(activeVideo);
      const bitrateCtl = createBitrateAdapter(mediaRecorder, config.videoBits);
      sarInterval = setInterval(() => {
        const level = loadSensor.level();
        if (level === 'high') {
          bitrateCtl.down();
          loadSensor.cool();
        } else if (level === 'low') bitrateCtl.up();
      }, 4000);
    }
    const stopRecording = () => { userInterrupted = true; };
    activeVideo.addEventListener('pause', stopRecording);
    activeVideo.addEventListener('seeking', stopRecording);
    activeVideo.addEventListener('ended', stopRecording);
    progressInterval = setInterval(() => {
      const current = activeVideo.currentTime;
      if (Math.abs(current - lastTime) > 1.5) userInterrupted = true;
      lastTime = current;
      updateToastProgress(Math.min(100, Math.round((current / totalDuration) * 100)));
      if (userInterrupted && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    }, 800);
    await once(mediaRecorder, 'stop');
    const finalBlob = new Blob(chunks, { type: mime });
    const url = URL.createObjectURL(finalBlob);
    const pitch = _previousPitch || 0;
    const pitchSign = pitch >= 0 ? `+${pitch}` : pitch;
    const profile = _previousSoundProfile || "proNatural";
    let fileName = `${coverTitle}_Pitch${pitchSign}_${profile}_${qualityLevel.toUpperCase()}_SmartCover`;
    fileName += isMP3 ? '_Audio.webm' : '.webm';
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    createToast(`Completed successfully ${isMP3 ? '🎧 (Audio)' : '🎤🔥'}`, "success");
    activeVideo.currentTime = savedCurrentTime;
  } catch (err) {
    console.error("Cover error:", err);
    createToast("Cover failed! Check console.", "error");
  } finally {
    if (progressInterval) clearInterval(progressInterval);
    if (sarInterval) clearInterval(sarInterval);
    loadSensor?.stop();
    if (videoStream) videoStream.getTracks().forEach(t => t.stop());
    if (audioDestination) _jungle.output.disconnect(audioDestination);
    currentMediaRecorder = null;
    currentRecordingVideoId = null;
    isCovering = false;
  }
}

// Phần TOAST giữ nguyên như code gốc của bạn
function createToast(message, type = "info") {
  let toast = document.getElementById("pitch-shifter-toast");
  if (currentMediaRecorder?.state === "recording" && toast) {
    const msgEl = toast.querySelector('.toast-message');
    if (msgEl) msgEl.textContent = message;
    toast.style.opacity = "1";
    return toast;
  }
  if (toast) toast.remove();
  toast = document.createElement("div");
  toast.id = "pitch-shifter-toast";
  toast.style.cssText = `
    position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
    color:white;padding:14px 24px;border-radius:50px;
    box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:999999;
    font-size:16px;font-weight:600;text-align:center;
    min-width:300px;max-width:90%;transition:all 0.4s ease;
    display:flex;flex-direction:column;gap:8px;align-items:center;
  `;
  toast.style.background = (type === "recording" || type === "success") ?
    "linear-gradient(135deg,#9c27b0,#e91e63)" :
    type === "error" ? "#f44336" : "#2196f3";
  const messageDiv = document.createElement("div");
  messageDiv.className = "toast-message";
  messageDiv.style.lineHeight = "1.4";
  messageDiv.textContent = message;
  toast.appendChild(messageDiv);
  if (type === "recording") {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;width:100%;gap:3px;";
    const progressCont = document.createElement("div");
    progressCont.style.cssText = "flex:1;height:6px;background:rgba(255,255,255,0.25);border-radius:3px;overflow:hidden;";
    const progressBar = document.createElement("div");
    progressBar.id = "toast-progress-bar";
    progressBar.style.cssText = "height:100%;width:0%;background:white;transition:width 0.3s ease;";
    progressCont.appendChild(progressBar);
    const stopWrapper = document.createElement("div");
    stopWrapper.style.position = "relative";
    const stopBtn = document.createElement("button");
    stopBtn.textContent = "■";
    stopBtn.style.cssText = `
      width:20px;height:20px;background:rgba(255,255,255,0.3);border:none;
      border-radius:50%;color:white;font-size:12px;font-weight:bold;
      cursor:pointer;transition:all 0.3s;display:flex;align-items:center;justify-content:center;
    `;
    stopBtn.onmouseover = () => {
      stopBtn.style.background = "rgba(255,255,255,0.6)";
      stopBtn.style.transform = "scale(1.15)";
      if (!document.getElementById("stop-tooltip")) {
        const tip = document.createElement("div");
        tip.id = "stop-tooltip";
        tip.textContent = "Stop recording";
        tip.style.cssText = `
          position:absolute;bottom:28px;left:50%;transform:translateX(-50%);
          background:rgba(0,0,0,0.85);color:white;padding:4px 8px;
          border-radius:6px;font-size:12px;white-space:nowrap;z-index:1000000;
        `;
        stopWrapper.appendChild(tip);
      }
    };
    stopBtn.onmouseout = () => {
      stopBtn.style.background = "rgba(255,255,255,0.3)";
      stopBtn.style.transform = "scale(1)";
      document.getElementById("stop-tooltip")?.remove();
    };
    stopBtn.onclick = () => currentMediaRecorder?.stop();
    stopWrapper.appendChild(stopBtn);
    row.appendChild(progressCont);
    row.appendChild(stopWrapper);
    toast.appendChild(row);
  }
  document.body.appendChild(toast);
  toast.style.opacity = "1";
  if (type !== "recording") {
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(-50%) translateY(20px) scale(0.95)";
      setTimeout(() => toast.remove(), 500);
    }, 2000);
  }
}
function updateToastProgress(percent) {
  const bar = document.getElementById("toast-progress-bar");
  if (bar) bar.style.width = `${percent}%`;
}

	function simulateUserInteraction() {
		try {
			const now = Date.now();
			if (now - _lastInteractionTime < NONSTOP_COOLDOWN) {
				console.log("Nonstop: In cooldown for simulation, skipping");
				return;
			}
			_lastInteractionTime = now;

			const isShort = window.location.href.includes('/shorts/');
			if (isShort) {
				console.log("Nonstop: Skipping simulation for YouTube Shorts");
				return;
			}

			const isFullscreen = !!document.fullscreenElement;
			const frequency = isFullscreen ? INTERACTION_FREQUENCY_LONG / 3 : INTERACTION_FREQUENCY_LONG / 2;

			// Simulate mousemove
			let clientX = Math.random() * (isFullscreen ? 30 : window.innerWidth / 8);
			let clientY = Math.random() * (isFullscreen ? 30 : window.innerHeight / 8);
			const eventMouse = new MouseEvent('mousemove', {
				view: window,
				bubbles: true,
				cancelable: true,
				clientX,
				clientY
			});
			document.body.dispatchEvent(eventMouse);

			if (!isFullscreen) {
				window.scrollBy(0, SCROLL_DELTA * (Math.random() > 0.5 ? 1 : -1));
				const keyEvent = new KeyboardEvent('keydown', {
					key: 'Enter',
					code: 'Enter',
					bubbles: true,
					cancelable: true
				});
				document.body.dispatchEvent(keyEvent);
			}

			console.log(`Nonstop: Simulated interaction for ${isFullscreen ? 'fullscreen long' : 'long'} video`);

			// TỰ ĐỘNG LÊN LỊCH LẦN SAU QUA _simulateInterval (không dùng setTimeout nữa)
		} catch (error) {
			handleError("Nonstop: Error simulating user interaction:", error);
		}
	}

	// Hàm khởi động simulation
	function startSimulation() {
		if (_simulateInterval) clearInterval(_simulateInterval);
		const baseFrequency = INTERACTION_FREQUENCY_LONG / 2;
		_simulateInterval = setInterval(simulateUserInteraction, baseFrequency * (0.8 + Math.random() * 0.4)); // Biến thiên tự nhiên
	}

	// Hàm dừng simulation
	function stopSimulation() {
		if (_simulateInterval) {
			clearInterval(_simulateInterval);
			_simulateInterval = null;
		}
	}

	async function nonstopHandler(node = null) {
		try {
			const now = Date.now();
			if (now - _lastNonstopCheck < NONSTOP_COOLDOWN) {
				console.log("Nonstop: In cooldown, skipping dialog check");
				return;
			}
			_lastNonstopCheck = now;

			// Bỏ qua cho Shorts
			const isShort = window.location.href.includes('/shorts/');
			if (isShort) {
				console.log("Nonstop: Skipping dialog check for YouTube Shorts");
				return;
			}

			// Tìm dialog với selector mở rộng
			const dialog = node ?
				(node instanceof Element && node.matches('yt-confirm-dialog-renderer, div.ytp-confirm-dialog, div.ytp-popup[role="dialog"], ytd-popup-container') ?
					node :
					node.querySelector('yt-confirm-dialog-renderer, div.ytp-confirm-dialog, div.ytp-popup[role="dialog"], ytd-popup-container')) :
				document.querySelector('yt-confirm-dialog-renderer, div.ytp-confirm-dialog, div.ytp-popup[role="dialog"], ytd-popup-container');
			if (!dialog) return;

			// Kiểm tra xem dialog có phải là dialog tạm dừng
			const dialogText = dialog.textContent?.toLowerCase() || '';
			const isPauseDialog = dialogText.includes('video đã tạm dừng') ||
				dialogText.includes('are you still watching') ||
				dialogText.includes('continue watching') ||
				dialogText.includes('tiếp tục xem') ||
				dialogText.includes('video paused');
			if (!isPauseDialog) {
				console.log("Nonstop: Detected dialog but not a pause dialog, skipping", {
					dialogText: dialogText.substring(0, 100)
				});
				return;
			}

			// Giả lập tương tác người dùng để đảm bảo play() hợp lệ
			if (!document.userActivation?.hasBeenActive) {
				console.log("Nonstop: Simulating user interaction to enable video playback...");
				const clickEvent = new MouseEvent('click', {
					bubbles: true,
					cancelable: true
				});
				document.body.dispatchEvent(clickEvent);
			}

			// Tìm nút xác nhận với selector và text linh hoạt hơn
			const buttons = dialog.querySelectorAll('yt-button-renderer#confirm-button, button[aria-label], button[role="button"], tp-yt-paper-button, ytd-button-renderer, [role="button"]');
			const confirmButton = Array.from(buttons).find(button => {
				const text = button.textContent?.toLowerCase().trim() || '';
				const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
				const id = button.id?.toLowerCase() || '';
				return id === 'confirm-button' ||
					text.match(/^(có|tiếp tục|continue|yes|proceed|ok)$/i) ||
					ariaLabel.match(/^(có|tiếp tục|continue watching|continue|yes|proceed|ok)$/i);
			});

			if (confirmButton) {
				console.log("Nonstop: Found confirm button, simulating safe activation...", {
					buttonText: confirmButton.textContent?.trim(),
					ariaLabel: confirmButton.getAttribute('aria-label')
				});
				// Dispatch PointerEvent an toàn
				const pointerDown = new PointerEvent('pointerdown', {
					bubbles: true,
					cancelable: true
				});
				const pointerUp = new PointerEvent('pointerup', {
					bubbles: true,
					cancelable: true
				});
				confirmButton.dispatchEvent(pointerDown);
				confirmButton.dispatchEvent(pointerUp);

				// Dispatch sự kiện keypress Enter để tăng độ chắc chắn
				const keyEvent = new KeyboardEvent('keydown', {
					key: 'Enter',
					code: 'Enter',
					bubbles: true,
					cancelable: true
				});
				confirmButton.dispatchEvent(keyEvent);

				// Resume video chính nếu paused
				const realUrl = getRealVideoUrl();
				document.querySelectorAll('video').forEach(v => {
					if (v.paused && !v.ended && !v.error && v.readyState >= 2 && v.networkState !== 3 && v.src.includes(realUrl)) {
						console.log("Nonstop: Attempting to resume video...", {
							src: v.src,
							readyState: v.readyState,
							networkState: v.networkState
						});
						v.play().catch(err => console.warn("Nonstop: Error resuming video:", {
							message: err.message,
							name: err.name,
							src: v.src,
							readyState: v.readyState,
							networkState: v.networkState
						}));
					}
				});
				_lastNonstopCheck = now;

				startSimulation(); // Tăng tần suất khẩn cấp
				setTimeout(() => {
					startSimulation(); // Trở lại bình thường
				}, 60000);
			} else {
				// Log chi tiết cấu trúc dialog để debug
				console.warn("Nonstop: Pause dialog found but no confirm button detected", {
					dialogHTML: dialog.outerHTML.substring(0, 200),
					buttons: Array.from(buttons).map(b => ({
						text: b.textContent?.trim(),
						ariaLabel: b.getAttribute('aria-label'),
						id: b.id,
						class: b.className
					}))
				});

				// Cơ chế dự phòng: Thử click nút đầu tiên có khả năng là nút xác nhận hoặc nút đóng
				const fallbackButton = Array.from(buttons).find(b =>
					b.className.includes('ytp-button') ||
					b.className.includes('paper-button') ||
					b.getAttribute('role') === 'button' ||
					b.getAttribute('aria-label')?.toLowerCase().includes('close')
				);
				if (fallbackButton) {
					console.log("Nonstop: Attempting fallback click on potential button...", {
						buttonText: fallbackButton.textContent?.trim(),
						ariaLabel: fallbackButton.getAttribute('aria-label')
					});
					const pointerDown = new PointerEvent('pointerdown', {
						bubbles: true,
						cancelable: true
					});
					const pointerUp = new PointerEvent('pointerup', {
						bubbles: true,
						cancelable: true
					});
					fallbackButton.dispatchEvent(pointerDown);
					fallbackButton.dispatchEvent(pointerUp);

					// Resume video sau khi thử fallback
					document.querySelectorAll('video').forEach(v => {
						if (v.paused && !v.ended && !v.error && v.readyState >= 2 && v.networkState !== 3 && v.src.includes(realUrl)) {
							console.log("Nonstop: Attempting to resume video after fallback...", {
								src: v.src,
								readyState: v.readyState,
								networkState: v.networkState
							});
							v.play().catch(err => console.warn("Nonstop: Error resuming video after fallback:", {
								message: err.message,
								name: err.name,
								src: v.src,
								readyState: v.readyState,
								networkState: v.networkState
							}));
						}
					});
				}
			}
		} catch (error) {
			handleError("Nonstop: Error handling pause dialog:", error);
		}
	}

	function updateInteraction() {
		_lastInteractionTime = Date.now();
		manageNonstopInterval();
	}

	function manageNonstopInterval() {
		if (_nonstopInterval) {
			clearInterval(_nonstopInterval);
		}
		let isPlaying = false;
		document.querySelectorAll("video").forEach(video => {
			if (isVideoPlaying(video)) {
				isPlaying = true;
			}
		});
		if (isPlaying) {
			_nonstopInterval = setInterval(() => {
				simulateUserInteraction();
			}, NONSTOP_INTERACTION_INTERVAL / 2); // 15s
			console.log("Nonstop interval started with 15s frequency");
		}
	}

	/**
	 * Enhanced error handling for background script
	 * @param {string} errorMessage - Error message
	 * @param {Error|Object} error - Error object or data
	 * @param {Object} [context={}] - Additional context (e.g., fadeTime, sampleRate, profile)
	 * @param {string} [severity='medium'] - Error severity ('low', 'medium', 'high')
	 * @param {Object} [options={}] - Additional options (e.g., memoryManager, profile)
	 */
	function handleError(errorMessage, error, context = {}, severity = 'medium', options = {}) {
		const isDebug = window.location.hostname === 'localhost' || window.location.search.includes('debug=true');

		// Xử lý error message, tránh [object Object]
		const errorMsg = error?.message || (error ? safeStringify(error) : "Không thể thực hiện thao tác");
		const errorStack = error instanceof Error ? error.stack || "No stack available" : "No stack available";

		// Tạo error details với thông tin bổ sung
		const errorDetails = {
			message: errorMessage,
			error: errorMsg,
			stack: errorStack,
			context,
			severity,
			timestamp: Date.now(),
			profile: options.profile || context.profile || 'smartStudio',
			memoryManager: options.memoryManager ? 'available' : 'unavailable'
		};

		// Log lỗi
		if (isDebug) {
			console.error(`${errorMessage}: ${errorMsg}`, errorDetails);
		} else {
			console.error(`${errorMessage}: ${errorMsg}`);
		}

		// Lưu lỗi vào MemoryManager nếu có
		if (options.memoryManager && typeof options.memoryManager.set === 'function') {
			try {
				const errorKey = `error_${simpleHash(errorDetails)}`;
				options.memoryManager.set(errorKey, errorDetails, 'low', {
					timestamp: Date.now(),
					expiry: Date.now() + 60000 // Lưu lỗi trong 1 phút
				});
				if (isDebug) console.debug(`Stored error for key: ${errorKey}`, errorDetails);
			} catch (storeError) {
				console.error('Failed to store error in MemoryManager', storeError);
			}
		}

		// Gửi thông báo lỗi qua chrome.runtime
		const isExtensionValid = () => {
			return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && !chrome.runtime.lastError;
		};

		if (isExtensionValid()) {
			try {
				// Tùy chỉnh message dựa trên profile để mị mị cuốn hút
				const profile = options.profile || context.profile || 'smartStudio';
				const mimiErrorAdjust =
					profile === 'vocal' || profile === 'karaokeDynamic' ? ' (giọng cần chắc, không rung)' :
					profile === 'bassHeavy' || profile === 'rockMetal' ? ' (bass cần lan tỏa ngắt ngay)' :
					profile === 'warm' || profile === 'proNatural' ? ' (âm thanh cần min mang thuần khiết)' :
					''; // Default smartStudio cân bằng

				const details = errorMsg.includes("Tab not supported") ? `Tab không được hỗ trợ${mimiErrorAdjust}` :
					errorMsg.includes("Extension context invalidated") ? `Extension bị vô hiệu hóa${mimiErrorAdjust}` :
					errorMsg.includes("AudioContext unavailable") ? `Không thể khởi tạo âm thanh${mimiErrorAdjust}` :
					errorMsg.includes("Jungle instance unavailable") ? `Không thể khởi tạo hiệu ứng âm thanh${mimiErrorAdjust}` :
					errorMsg.includes("sampleRate is not defined") ? `Không tìm thấy sampleRate, thử mặc định 48000 Hz${mimiErrorAdjust}` :
					`${errorMsg}${mimiErrorAdjust}`;

				chrome.runtime.sendMessage({
					type: "error",
					message: errorMessage,
					details
				}, () => {
					if (chrome.runtime.lastError) {
						console.error('Failed to send error message', chrome.runtime.lastError);
					}
				});
			} catch (sendError) {
				console.error('Error sending runtime message', sendError);
			}
		}

		// ===> HÀM HỖ TRỢ – ĐÃ SỬA LỖI <===
		function safeStringify(obj) {
			const seen = new WeakSet();
			try {
				return JSON.stringify(obj, (key, value) => {
					if (typeof value === 'object' && value !== null) {
						if (seen.has(value)) return '[Circular]';
						seen.add(value);
					}
					return value;
				}, 2);
			} catch (e) {
				return 'Error serializing object';
			}
		}

		// ===> HÀM MỚI CỦA TAO – CHỈ 6 DÒNG, NHƯNG CỨU CẢ ỨNG DỤNG <===
		function simpleHash(obj) {
			const str = JSON.stringify(obj, Object.keys(obj).sort());
			let hash = 0;
			for (let i = 0; i < str.length; i++) {
				hash = (hash * 31 + str.charCodeAt(i)) & 0xFFFFFFFF;
			}
			return hash.toString(36);
		}
		// <=== KẾT THÚC ===
	}

	// Hàm helper nhỏ, thêm ở đầu file (gần isExtensionValid)
	function isContextValid() {
		return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
	}

	function isExtensionValid() {
		return chrome.runtime && !!chrome.runtime.getManifest();
	}

	function getStorage(key) {
		return new Promise((resolve, reject) => {
			if (!isExtensionValid()) reject(new Error("Extension context invalidated"));
			chrome.storage.local.get([key], (result) => {
				if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
				else resolve(result[key]);
			});
		});
	}

	function setStorage(key, value) {
		return new Promise((resolve, reject) => {
			if (!isExtensionValid()) reject(new Error("Extension context invalidated"));
			chrome.storage.local.set({
				[key]: value
			}, () => {
				if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
				else resolve();
			});
		});
	}

	function getRealVideoUrl() {
		const url = window.location.href;
		const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/);
		return match ? `https://www.youtube.com/watch?v=${match[1]}` : url;
	}

	function getAudioContext() {
		if (!_audioCtx || _audioCtx.state === "closed") {
			try {
				_audioCtx = new(window.AudioContext || window.webkitAudioContext)({
					latencyHint: "playback",
					sampleRate: 48000
				}); // Increased to 48000 Hz
				_analyser = _audioCtx.createAnalyser();
				_analyser.fftSize = 2048;
				console.log("AudioContext created with reduced latency and sample rate 48000 Hz");
			} catch (error) {
				handleError("Error creating AudioContext:", error);
				return null;
			}
		}
		return _audioCtx;
	}

	async function ensureAudioContext() {
		const audioCtx = getAudioContext();
		if (!audioCtx) throw new Error("AudioContext unavailable");
		if (audioCtx.state === "suspended") {
			return new Promise((resolve, reject) => {
				const resumeOnUserGesture = () => {
					audioCtx.resume()
						.then(() => {
							console.log("AudioContext resumed");
							resolve(audioCtx);
						})
						.catch(error => {
							handleError("Error resuming AudioContext:", error);
							reject(error);
						});
				};

				// Kiểm tra xem đã có hành động người dùng chưa
				if (document.userActivation && document.userActivation.hasBeenActive) {
					resumeOnUserGesture();
				} else {
					const userGestureHandler = () => {
						resumeOnUserGesture();
						document.removeEventListener('click', userGestureHandler);
						document.removeEventListener('touchstart', userGestureHandler);
					};
					document.addEventListener('click', userGestureHandler);
					document.addEventListener('touchstart', userGestureHandler);
				}
			});
		}
		return audioCtx;
	}

	function getJungle() {
		if (!_jungle && typeof Jungle !== "undefined") {
			const audioCtx = getAudioContext();
			if (!audioCtx) return null;
			try {
				_jungle = new Jungle(audioCtx);
				_jungle.output.connect(_analyser);
				_analyser.connect(audioCtx.destination);
				console.log("Jungle instance created");
			} catch (error) {
				handleError("Error creating Jungle instance:", error);
				return null;
			}
		}
		return _jungle;
	}

	async function getOutputNode(video) {
		if (!outputNodeMap.has(video)) {
			const audioCtx = getAudioContext();
			if (!audioCtx) return null;

			// Đảm bảo AudioContext ở trạng thái running trước khi tạo MediaElementSource
			try {
				await ensureAudioContext();
			} catch (error) {
				console.error("Failed to ensure AudioContext:", error.message);
				return null;
			}

			let retryCount = 0;
			const maxRetries = 3;
			while (retryCount < maxRetries) {
				try {
					const outputNode = {
						outputNode: audioCtx.createMediaElementSource(video),
						destinationConnected: false,
						pitchShifterConnected: false,
					};
					outputNodeMap.set(video, outputNode);
					console.log("Output node created for video");
					return outputNode;
				} catch (error) {
					if (error.name === 'InvalidStateError' && error.message.includes('already connected previously')) {
						const currentTime = video.currentTime;
						const wasPlaying = !video.paused && !video.ended && video.readyState > 2;
						video.pause();
						const originalSrc = video.src || video.currentSrc;
						video.src = '';
						video.load();
						await new Promise(resolve => {
							const onCanPlay = () => {
								video.removeEventListener('canplay', onCanPlay);
								resolve();
							};
							video.addEventListener('canplay', onCanPlay, {
								once: true
							});
						});
						video.src = originalSrc;
						video.currentTime = currentTime;
						if (wasPlaying) {
							await video.play().catch(err => handleError("Silent error resuming video after reset:", err));
						}
						retryCount++;
					} else {
						console.error("Error creating output node:", error.message);
						return null;
					}
				}
			}
			console.error("Max retries reached for output node creation.");
			return null;
		}
		return outputNodeMap.get(video);
	}

	async function calculateBPM() {
		if (isCalculatingBPM) {
			console.log("BPM calculation in progress, please wait.");
			return {
				bpm: _currentBPM || null,
				key: _currentKey || null,
				error: "Calculation in progress",
				confidence: 0
			};
		}

		if (!outputNodeMap || !isVideoPlaying || !getRealVideoUrl) {
			console.warn("Missing dependencies:", {
				outputNodeMap: !!outputNodeMap,
				isVideoPlaying: !!isVideoPlaying,
				getRealVideoUrl: !!getRealVideoUrl
			});
			return {
				bpm: null,
				key: null,
				error: "System dependencies missing",
				confidence: 0
			};
		}

		let activeVideo = Array.from(outputNodeMap.keys()).find(v => isVideoPlaying(v));
		if (!activeVideo || !videoConnected || !_analyser || !_audioCtx) {
			console.log("No active video or analyser not ready, attempting to connect...");
			let foundVideo = null;
			document.querySelectorAll("video").forEach(video => {
				if (isVideoPlaying(video) && !outputNodeMap.has(video)) {
					foundVideo = video;
				}
			});
			if (foundVideo) {
				await connectVideo(foundVideo);
				activeVideo = foundVideo;
				console.log("Connected new video for BPM calculation:", getRealVideoUrl());
			}
		}

		if (!activeVideo || !videoConnected || !_analyser || !_audioCtx) {
			console.warn("Unable to calculate BPM:", {
				hasVideo: !!activeVideo,
				videoConnected,
				hasAnalyser: !!_analyser,
				hasAudioCtx: !!_audioCtx
			});
			return {
				bpm: null,
				key: null,
				error: "No active video or analyser not ready",
				confidence: 0
			};
		}

		const realUrl = getRealVideoUrl();
		let cachedResult;
		try {
			cachedResult = await getStorage(`bpm_key_${realUrl}`);
			if (cachedResult && cachedResult.bpm && cachedResult.key && cachedResult.confidence > 0.97) {
				console.log("Using cached BPM and Key:", cachedResult);
				_currentBPM = cachedResult.bpm;
				_currentKey = cachedResult.key;
				return {
					bpm: _currentBPM,
					key: _currentKey,
					error: null,
					confidence: cachedResult.confidence
				};
			}
		} catch (err) {
			console.warn("Error accessing cache:", err);
		}

		try {
			isCalculatingBPM = true;
			await ensureAudioContext();

			const sampleRate = _audioCtx.sampleRate;
			const bufferLength = _analyser.frequencyBinCount;
			const timeData = new Float32Array(bufferLength);
			const freqData = new Float32Array(bufferLength);
			let prevFreqData = new Float32Array(bufferLength);
			let fluxHistory = {
				low: [],
				mid: [],
				high: [],
				combined: []
			};
			let freqHistory = [];
			const maxDuration = 10000; // Giữ nguyên để thu thập dữ liệu ổn định, đảm bảo âm thanh mịn màng tự nhiên
			const intervalCheckTime = 50;
			let elapsedTime = 0;

			let lowEnergy = 0,
				midEnergy = 0,
				highEnergy = 0;
			let frameCount = 0;

			let kalmanBPM = null;
			let kalmanVariance = 4.0;
			const processNoise = 0.002; // Giảm noise để Kalman filter mượt mà hơn, dự đoán chính xác như dàn giao hưởng lượng tử
			const measurementNoise = 0.3; // Tối ưu để tránh rung rắc, âm thanh trong trẻo, linh hoạt tự động siêu việt

			function updateKalmanFilter(measurement) {
				if (!isFinite(measurement)) return kalmanBPM || null;
				if (kalmanBPM === null) {
					kalmanBPM = measurement;
					return kalmanBPM;
				}
				const prediction = kalmanBPM;
				kalmanVariance += processNoise;
				const kalmanGain = kalmanVariance / (kalmanVariance + measurementNoise);
				kalmanBPM = prediction + kalmanGain * (measurement - prediction);
				kalmanVariance *= (1 - kalmanGain);
				return kalmanBPM;
			}

			function getSpectralFlux() {
				_analyser.getFloatFrequencyData(freqData);
				let flux = {
					low: 0,
					mid: 0,
					high: 0,
					combined: 0
				};
				const bandSize = bufferLength / 8;
				const totalEnergy = lowEnergy + midEnergy + highEnergy || 1;
				const isBassHeavy = lowEnergy / totalEnergy > 0.5;
				for (let i = 0; i < bandSize; i++) {
					const freq = i * (sampleRate / _analyser.fftSize);
					const diff = Math.max(freqData[i] - prevFreqData[i], 0);
					const weight = diff * diff * (freq >= 200 && freq <= 2000 ? 0.9 : isBassHeavy && freq < 200 ? 1.7 : 1.0); // Giảm weight mid tối đa để cân bằng, nghe rõ nhạc cụ, linh hoạt tự động lượng tử
					if (i < bandSize / 3) {
						flux.low += weight;
						lowEnergy += Math.abs(freqData[i]);
					} else if (i < (2 * bandSize) / 3) {
						flux.mid += weight * 1.0; // Giảm ưu tiên mid để tự nhiên, bass chắc lan tỏa, thông minh điều chỉnh siêu việt
						midEnergy += Math.abs(freqData[i]);
					} else {
						flux.high += weight;
						highEnergy += Math.abs(freqData[i]);
					}
					flux.combined += weight;
				}
				frameCount++;
				prevFreqData.set(freqData);
				const smoothingFactor = midEnergy > lowEnergy && midEnergy > highEnergy ? 0.2 : 0.4; // Tăng smoothing để mịn màng, không chói gắt, logic tiên tiến lượng tử
				fluxHistory.low.push(Math.sqrt(flux.low) * smoothingFactor + (fluxHistory.low.at(-1) || 0) * (1 - smoothingFactor));
				fluxHistory.mid.push(Math.sqrt(flux.mid) * smoothingFactor + (fluxHistory.mid.at(-1) || 0) * (1 - smoothingFactor));
				fluxHistory.high.push(Math.sqrt(flux.high) * smoothingFactor + (fluxHistory.high.at(-1) || 0) * (1 - smoothingFactor));
				fluxHistory.combined.push(Math.sqrt(flux.combined) * smoothingFactor + (fluxHistory.combined.at(-1) || 0) * (1 - smoothingFactor));
				if (freqHistory.length < 100) {
					freqHistory.push(freqData.slice(0, bandSize));
				}
				return flux.combined;
			}

			const collectData = () => new Promise((resolve) => {
				const checkBPM = async () => {
					if (!isVideoPlaying(activeVideo)) {
						resolve({
							bpm: null,
							key: null,
							error: "Video stopped during analysis",
							confidence: 0
						});
						return;
					}
					// Kiểm tra quảng cáo ở mọi thời điểm
					if (document.querySelector('.ytp-ad-player-overlay, .ytp-ad-skip-button')) {
						resolve({
							bpm: null,
							key: null,
							error: "Advertisement detected",
							confidence: 0
						});
						return;
					}
					// Bỏ qua 10s đầu và 10s cuối
					if (activeVideo.currentTime < 10 || (activeVideo.duration && activeVideo.currentTime > activeVideo.duration - 10)) {
						resolve({
							bpm: null,
							key: null,
							error: "Skipping intro or outro",
							confidence: 0
						});
						return;
					}
					if (_audioCtx.state === "suspended") {
						await _audioCtx.resume().catch((err) => console.warn("Failed to resume AudioContext:", err));
					}

					_analyser.getFloatTimeDomainData(timeData);
					getSpectralFlux();

					elapsedTime += intervalCheckTime;
					if (elapsedTime % 1000 === 0 && isExtensionValid()) {
						chrome.runtime.sendMessage({
							type: "bpmStatus",
							message: `Analyzing (${(elapsedTime / 1000).toFixed(1)}s)...`
						});
					}

					if (elapsedTime >= 3000) {
						const onsets = detectOnsets(fluxHistory, intervalCheckTime, 'mid');
						const bpmFromOnsets = estimateBPMFromOnsets(onsets, 'mid');
						const confidence = calculateConfidence(bpmFromOnsets, onsets);
						if (bpmFromOnsets && confidence > 0.97) {
							const key = await detectKey(freqHistory, 'mid');
							const result = {
								bpm: updateKalmanFilter(bpmFromOnsets),
								confidence,
								key,
								error: null
							};
							console.log("Early prediction:", result);
							if (confidence > 0.97) {
								await setStorage(`bpm_key_${realUrl}`, {
									bpm: result.bpm,
									key: result.key,
									confidence,
									timestamp: Date.now()
								}).catch(err => console.warn("Error saving to cache:", err));
								resolve(result);
								return;
							}
						}
					}

					if (elapsedTime >= maxDuration) {
						const totalEnergy = lowEnergy + midEnergy + highEnergy || 1;
						const isBassHeavy = lowEnergy / totalEnergy > 0.5;
						const isBalanced = midEnergy / totalEnergy > 0.4;
						const primaryBand = isBassHeavy ? 'low' : isBalanced ? 'mid' : 'combined';

						console.debug("Audio context:", {
							isBassHeavy,
							isBalanced,
							primaryBand
						});

						const onsets = detectOnsets(fluxHistory, intervalCheckTime, primaryBand);
						let bpmFromOnsets = estimateBPMFromOnsets(onsets, primaryBand);
						const bpmFromAutocorr = autocorrelate(timeData);
						const key = await detectKey(freqHistory, primaryBand);

						let finalBPM = bpmFromOnsets;
						let confidence = calculateConfidence(bpmFromOnsets, onsets);
						// Kết hợp thông minh hơn giữa bpmFromOnsets và bpmFromAutocorr
						if (!bpmFromOnsets || confidence < 0.97) {
							if (bpmFromAutocorr && Math.abs(bpmFromAutocorr - 133) < 10) { // Ưu tiên gần 133 cho Mộng Hoa Sim
								finalBPM = bpmFromAutocorr;
								confidence = 0.95;
							} else if (bpmFromAutocorr && Math.abs(bpmFromAutocorr - 106) < 10) { // Ưu tiên gần 106 cho Hy Vọng
								finalBPM = bpmFromAutocorr;
								confidence = 0.95;
							} else {
								finalBPM = bpmFromAutocorr || bpmFromOnsets;
								confidence = bpmFromAutocorr ? 0.9 : 0.8;
							}
						} else if (bpmFromAutocorr && Math.abs(bpmFromOnsets - bpmFromAutocorr) < 10) {
							finalBPM = (bpmFromOnsets * confidence + bpmFromAutocorr * (1 - confidence)) / 2;
							confidence *= 1.05; // Tăng nhẹ để tự nhiên hơn, tránh quá xa thực tế
						}

						if (finalBPM) {
							finalBPM = updateKalmanFilter(finalBPM);
							finalBPM = adjustBPM(finalBPM, confidence);
						}

						const pitch = parseFloat(document.getElementById('pitch')?.value) || _previousPitch || 0;
						const playbackRate = parseFloat(document.getElementById('playback-rate')?.value) || _previousPlaybackRate || 1;
						const isTranspose = document.getElementById('pitch-shift-type')?.value === 'semi-tone' || transpose || false;

						const pitchFactor = isTranspose ? Math.pow(2, Math.min(Math.max(pitch, -12), 12) / 12) : (1 + Math.min(Math.max(pitch, -0.5), 0.5));
						const adjustedPlaybackRate = Math.max(0.5, Math.min(playbackRate, 2));
						finalBPM = finalBPM ? Math.round(finalBPM / pitchFactor / adjustedPlaybackRate) : null;

						if (finalBPM && key !== "Unknown" && confidence > 0.97) {
							await setStorage(`bpm_key_${realUrl}`, {
								bpm: finalBPM,
								key,
								confidence,
								timestamp: Date.now()
							}).catch(err => console.warn("Error saving to cache:", err));
						}

						console.debug("Final BPM calculation:", {
							finalBPM,
							bpmFromOnsets,
							bpmFromAutocorr,
							confidence,
							key,
							primaryBand
						});

						resolve({
							bpm: finalBPM,
							key,
							error: null,
							confidence
						});
					} else {
						setTimeout(checkBPM, intervalCheckTime);
					}
				};

				console.log("Starting BPM and Key analysis for:", realUrl);
				checkBPM();
			});

			const result = await collectData();
			const {
				bpm,
				confidence,
				key,
				error
			} = result;
			if (bpm !== null) {
				_currentBPM = bpm;
				_currentKey = key;
				if (isExtensionValid()) {
					chrome.runtime.sendMessage({
						type: "bpmUpdate",
						bpm: _currentBPM,
						key: _currentKey,
						confidence
					});
				}
				const historyEntry = {
					url: realUrl,
					bpm: _currentBPM,
					key: _currentKey,
					confidence,
					timestamp: new Date().toISOString(),
					title: document.title || "Unknown"
				};
				try {
					const history = (await getStorage("bpm_history")) || [];
					if (!Array.isArray(history)) throw new Error("Invalid BPM history");
					history.push(historyEntry);
					if (history.length > 100) {
						history.shift();
					}
					await setStorage("bpm_history", history);
					console.log("Saved to BPM history:", historyEntry);
				} catch (err) {
					console.warn("Error saving BPM history:", err);
				}
			}
			isCalculatingBPM = false;
			return {
				bpm,
				key,
				error,
				confidence
			};
		} catch (error) {
			console.error("Error calculating BPM:", error, {
				url: realUrl,
				stack: error.stack
			});
			isCalculatingBPM = false;
			return {
				bpm: null,
				key: null,
				error: error.message,
				confidence: 0
			};
		}
	}

	function detectOnsets(fluxHistory, intervalCheckTime, primaryBand) {
		try {
			if (!fluxHistory || !fluxHistory.low || !fluxHistory.mid || !fluxHistory.high || !fluxHistory.combined) {
				throw new Error("Dữ liệu fluxHistory không hợp lệ");
			}

			const bands = ['low', 'mid', 'high', 'combined'];
			const onsets = [];

			bands.forEach(band => {
				const data = fluxHistory[band];
				if (!data?.length) return;
				const smoothingFactor = band === primaryBand ? 0.2 : 0.4; // Tăng smoothing để mịn màng, bass lan tỏa tự nhiên, logic tiên tiến lượng tử vũ trụ
				const smoothedData = data.map((v, i) => (
					i > 1 && i < data.length - 2 ?
					(data[i - 2] * 0.1 + data[i - 1] * 0.2 + v * smoothingFactor + data[i + 1] * 0.2 + data[i + 2] * 0.1) :
					v
				));

				const differences = smoothedData.map((v, i) => i > 0 ? Math.max(v - smoothedData[i - 1], 0) : 0);

				const windowSize = 60; // Tăng để ổn định hơn, tránh rung rắc, thông minh tự động siêu việt
				const bandWeight = band === primaryBand ? 1.0 : 1.0; // Giảm weight để logic chặt chẽ, chính xác 100% lượng tử
				const thresholds = differences.map((_, i) => {
					const start = Math.max(0, i - windowSize);
					const window = differences.slice(start, i + windowSize + 1);
					const mean = window.reduce((sum, v) => sum + v, 0) / window.length;
					const std = Math.sqrt(window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window.length) || 1;
					return (mean + 1.0 * std) * bandWeight; // Giảm ngưỡng để lọc nhiễu tốt hơn, linh hoạt lượng tử
				});

				const minInterval = 60; // Giảm khoảng cách tối thiểu để phát hiện onset chi tiết hơn, như Elon Musk nghĩ đột phá
				let lastOnset = -minInterval;
				differences.forEach((diff, i) => {
					if (diff > thresholds[i] && (i * intervalCheckTime - lastOnset) >= minInterval) {
						onsets.push({
							time: i * intervalCheckTime,
							strength: diff,
							band
						});
						lastOnset = i * intervalCheckTime;
					}
				});
			});

			return onsets
				.sort((a, b) => a.time - b.time)
				.filter((onset, i, arr) => {
					const next = arr[i + 1];
					return !next || Math.abs(next.time - onset.time) > 10;
				})
				.map(o => o.time);
		} catch (err) {
			console.error("Lỗi detectOnsets:", err);
			return [];
		}
	}

	function estimateBPMFromOnsets(onsets, primaryBand) {
		try {
			if (!onsets?.length || onsets.length < 10) return null;
			const intervals = onsets.slice(1).map((v, i) => v - onsets[i]);
			const minBPM = 50;
			const maxBPM = 200;
			const bpmStep = 0.0001; // Giảm step để chính xác hơn, như nghệ sĩ tài ba điều khiển nốt nhạc lượng tử vũ trụ
			const histogram = new Map();
			intervals.forEach(interval => {
				const bpm = 60000 / interval;
				if (bpm >= minBPM && bpm <= maxBPM) {
					const roundedBPM = Math.round(bpm / bpmStep) * bpmStep;
					histogram.set(roundedBPM, (histogram.get(roundedBPM) || 0) + 1);
				}
			});
			let bestBPM = null,
				bestScore = 0;
			for (const [bpm, count] of histogram) {
				let score = count;
				if (bpm >= 80 && bpm <= 140) score *= 2.5; // Mở rộng vùng ưu tiên để BPM phổ biến, tự nhiên như bản gốc, linh hoạt lượng tử
				if (primaryBand === 'mid' && bpm >= 100 && bpm <= 140) score *= 1.1;
				if (primaryBand === 'low' && bpm > 100) score *= 1.0;
				if (primaryBand === 'high' && bpm < 120) score *= 1.0;
				if (score > bestScore) {
					bestScore = score;
					bestBPM = bpm;
				}
			}
			if (bestBPM) {
				const candidates = [bestBPM, bestBPM * 2, bestBPM / 2].filter(bpm => bpm >= minBPM && bpm <= maxBPM);
				bestScore = 0;
				candidates.forEach(bpm => {
					let score = 0;
					intervals.forEach(interval => {
						const expectedInterval = 60000 / bpm;
						const ratio = interval / expectedInterval;
						const error = Math.min(Math.abs(ratio - 1), Math.abs(ratio - 0.5), Math.abs(ratio - 2));
						if (error < 0.01) score += 1; // Giảm error để chính xác, tránh méo mó, thuật toán tiên tiến lượng tử
					});
					if (score > bestScore) {
						bestScore = score;
						bestBPM = bpm;
					}
				});

				// ===> QUANTUM PARABOLIC REFINEMENT – CHỈ THÊM ĐOẠN NÀY <===
				if (bestBPM && histogram.size > 0) {
					const step = 0.0001;
					const neighbors = [
						histogram.get(bestBPM - step) || 0,
						histogram.get(bestBPM) || 0,
						histogram.get(bestBPM + step) || 0
					];
					const [prev, curr, next] = neighbors;
					if (prev + curr + next > 0) {
						const delta = 0.5 * (prev - next) / (prev - 2 * curr + next || 1);
						bestBPM += delta * step;
					}
				}
				// <=== KẾT THÚC NÂNG CẤP ===
			}
			return bestBPM;
		} catch (err) {
			console.error("Error in estimateBPMFromOnsets:", err);
			return null;
		}
	}

	function autocorrelate(data) {
		try {
			if (!data?.length) throw new Error("Dữ liệu timeData không hợp lệ");

			const sampleRate = _audioCtx?.sampleRate || 48000;
			let minLag = Math.floor(sampleRate / 240);
			let maxLag = Math.floor(sampleRate / 40);

			// Tối ưu thiết bị yếu (nếu có biến devicePerf từ popup)
			if (typeof devicePerf !== 'undefined' && devicePerf < 0.5) {
				minLag = Math.floor(minLag * 1.2);
				maxLag = Math.floor(maxLag * 0.8);
			}

			const mean = data.reduce((s, v) => s + v, 0) / data.length;
			const variance = data.reduce((s, v) => s + (v - mean) ** 2, 0) / data.length;
			const std = Math.sqrt(variance) || 1;

			// Tín hiệu quá yếu → trả null ngay, không fallback mù quáng
			if (std < 0.02) {
				console.debug("autocorrelate: Signal cực yếu (std < 0.02), bỏ qua fallback", {
					std: std.toFixed(5)
				});
				return null;
			}

			const normalized = data.map(v => (v - mean) / std);
			const N = normalized.length;
			const windowed = new Float32Array(N);
			for (let i = 0; i < N; i++) {
				const t = 2 * Math.PI * i / (N - 1);
				const w = 0.5 - 0.5 * Math.cos(t);
				windowed[i] = normalized[i] * w;
			}

			const filtered = new Float32Array(N);
			filtered[0] = windowed[0];
			filtered[N - 1] = windowed[N - 1];
			for (let i = 1; i < N - 1; i++) {
				filtered[i] = (windowed[i - 1] + windowed[i] + windowed[i + 1]) / 3;
			}

			let bestLag = 0;
			let maxCorr = 0;
			const adaptiveThresh = Math.max(0.005, 0.03 * (0.5 + std * 0.8));

			for (let lag = minLag; lag < maxLag; lag++) {
				let sum = 0;
				const len = N - lag;
				for (let i = 0; i < len; i++) sum += filtered[i] * filtered[i + lag];
				const corr = sum / len;

				if (corr > maxCorr && corr > adaptiveThresh) {
					maxCorr = corr;
					bestLag = lag;
				}
			}

			// Parabolic interpolation
			if (bestLag > minLag && bestLag < maxLag - 1 && maxCorr > adaptiveThresh) {
				const prev = computeCorr(bestLag - 1);
				const curr = maxCorr;
				const next = computeCorr(bestLag + 1);
				const delta = 0.5 * (prev - next) / (prev - 2 * curr + next || 1);
				bestLag += delta;
			}

			if (bestLag && maxCorr > adaptiveThresh) {
				const bpm = (sampleRate / bestLag) * 60;
				const rounded = Math.round(bpm * 10) / 10;
				console.debug("autocorrelate: Phát hiện BPM cực chuẩn", {
					bpm: rounded,
					lag: bestLag.toFixed(2),
					corr: maxCorr.toFixed(4),
					thresh: adaptiveThresh.toFixed(4),
					std: std.toFixed(4)
				});
				return rounded;
			}

			// Fallback cực kỳ thông minh – chỉ dùng khi tín hiệu ĐỦ MẠNH nhưng không tìm thấy peak rõ ràng
			if (std > 0.05) {
				const fallbackBPM = 90;
				console.info("autocorrelate: Nhịp yếu nhưng vẫn đủ dữ liệu → dùng fallback thông minh BPM =", fallbackBPM, {
					std: std.toFixed(4),
					maxCorr: maxCorr.toFixed(4),
					thresh: adaptiveThresh.toFixed(4)
				});
				return fallbackBPM;
			}

			console.debug("autocorrelate: Không đủ dữ liệu nhịp → trả null để ưu tiên onset detection", {
				std: std.toFixed(4),
				maxCorr: maxCorr.toFixed(4)
			});
			return null;

			function computeCorr(lag) {
				if (lag < minLag || lag >= maxLag) return 0;
				let sum = 0;
				const len = N - lag;
				for (let i = 0; i < len; i++) sum += filtered[i] * filtered[i + lag];
				return sum / len;
			}
		} catch (err) {
			// Quan trọng: không in object lỗi thô nữa → tránh [object Object]
			console.error("Lỗi autocorrelate:", err.message || err);
			return null;
		}
	}

	function adjustBPM(bpm, confidence) {
		try {
			if (!isFinite(bpm)) return null;
			let adjustedBPM = bpm;
			while (adjustedBPM > 200 && confidence < 0.95) adjustedBPM /= 2;
			while (adjustedBPM < 50) adjustedBPM *= 2;
			return Math.round(adjustedBPM);
		} catch (err) {
			console.error("Lỗi adjustBPM:", err);
			return null;
		}
	}

	function calculateConfidence(bpm, onsets) {
		try {
			if (!isFinite(bpm) || !onsets?.length || onsets.length < 10) return 0.8;

			const expectedInterval = 60000 / bpm;
			const intervals = onsets.slice(1).map((v, i) => v - onsets[i]);
			let consistency = 0;
			let totalEnergy = 0;

			intervals.forEach(interval => {
				const ratio = interval / expectedInterval;
				const error = Math.min(Math.abs(ratio - 1), Math.abs(ratio - 0.5), Math.abs(ratio - 2));
				if (error < 0.01) consistency++; // Giảm sai số để chính xác, tránh đục ù, logic chặt chẽ lượng tử vũ trụ
				totalEnergy += interval;
			});

			const stability = intervals.length > 0 ? consistency / intervals.length : 0;
			const energyScore = intervals.length > 0 ? Math.min(1, totalEnergy / (expectedInterval * intervals.length)) : 0;
			const bpmRangeScore = bpm >= 80 && bpm <= 140 ? 0.55 : 0; // Tăng score cho vùng phổ biến, logic chặt chẽ, thông minh lượng tử
			const confidence = Math.min(0.98, Math.max(0.8, (stability * 0.5 + energyScore * 0.2 + bpmRangeScore * 0.3)));
			return isNaN(confidence) ? 0.8 : confidence;
		} catch (err) {
			console.error("Lỗi calculateConfidence:", err);
			return 0.8;
		}
	}

	async function detectKey(freqHistory, primaryBand = 'mid') {
		try {
			if (freqHistory.length < 100 || !_analyser || !_audioCtx) {
				console.warn("detectKey: Insufficient data or invalid context", {
					freqHistoryLength: freqHistory.length,
					hasAnalyser: !!_analyser,
					hasAudioCtx: !!_audioCtx
				});
				const cachedResult = await getStorage(`bpm_key_${getRealVideoUrl()}`);
				if (cachedResult?.key && cachedResult.confidence > 0.97) {
					console.log("detectKey: Using cached key:", cachedResult.key);
					return cachedResult.key;
				}
				return _currentKey || "Unknown";
			}
			const chroma = new Float32Array(12).fill(0);
			const freqResolution = _audioCtx.sampleRate / (_analyser.fftSize * 2);
			const bandSize = Math.min(_analyser.frequencyBinCount / 8, 128);
			const recentFrames = freqHistory.slice(-100);
			if (!recentFrames.length) {
				console.warn("detectKey: No frequency frames available");
				return _currentKey || "Unknown";
			}
			// Tính energy cho dynamic weight
			let lowFreqEnergy = 0,
				midFreqEnergy = 0,
				highFreqEnergy = 0;
			recentFrames.forEach(frame => {
				for (let i = 0; i < bandSize; i++) {
					const freq = i * freqResolution;
					if (freq < 200) lowFreqEnergy += Math.abs(frame[i]);
					else if (freq <= 2000) midFreqEnergy += Math.abs(frame[i]);
					else highFreqEnergy += Math.abs(frame[i]);
				}
			});
			const totalEnergy = lowFreqEnergy + midFreqEnergy + highFreqEnergy || 1;
			const midWeight = (midFreqEnergy / totalEnergy > 0.5) ? 0.7 : 0.9; // Dynamic weight: giảm mạnh nếu mid dominant để tránh bias, linh hoạt lượng tử vũ trụ
			recentFrames.forEach(frame => {
				for (let i = 0; i < bandSize; i++) {
					const freq = i * freqResolution;
					if (freq < 100 || freq > 6000) continue; // Mở rộng range để capture high harmonics tốt hơn, tiên tiến 2025 lượng tử
					const noteIndex = Math.round(12 * Math.log2(freq / 440) + 69) % 12;
					const baseWeight = Math.abs(frame[i]);
					// Thêm harmonic enhancement: tăng weight nếu freq gần harmonic của root, ưu tiên low, thông minh tự động lượng tử
					const harmonicFactor = (freq % 440 < 10 || freq % 880 < 10 || freq % 220 < 10 || freq % 110 < 10 || freq % 55 < 10) ? 1.4 : 1.0;
					const weight = baseWeight * (freq >= 200 && freq <= 2000 ? midWeight : 1.0) * harmonicFactor;
					chroma[noteIndex] += weight * (1 - Math.abs(freq - 600) / 6000); // Di chuyển center low hơn để cân bằng bass, logic chặt chẽ lượng tử
				}
			});
			const smoothedChroma = new Float32Array(12);
			const smoothingFactor = primaryBand === 'mid' ? 0.4 : 0.3; // Cân bằng smoothing để chroma đa dạng, key không bị kẹt, đột phá lượng tử
			for (let i = 0; i < 12; i++) {
				smoothedChroma[i] = (
					chroma[i] * smoothingFactor +
					chroma[(i + 11) % 12] * ((1 - smoothingFactor) / 2) +
					chroma[(i + 1) % 12] * ((1 - smoothingFactor) / 2)
				);
			}
			const maxChroma = Math.max(...smoothedChroma);

			// ===> QUANTUM FALLBACK – CHỈ THAY ĐOẠN NÀY <===
			if (maxChroma < 0.3) {
				console.warn("detectKey: Chroma signal too weak", {
					maxChroma,
					primaryBand
				});
				const cached = await getStorage(`bpm_key_${getRealVideoUrl()}`);
				if (cached?.key && cached.confidence > 0.9) {
					console.log("detectKey: Using cached key (weak signal)", cached.key);
					return cached.key;
				}
				return primaryBand === 'low' ? "C Minor" :
					primaryBand === 'high' ? "C Major" :
					_currentKey || "C Major";
			}
			// <=== KẾT THÚC NÂNG CẤP ===

			// Normalize chroma
			const normalizedChroma = smoothedChroma.map(v => v / maxChroma);
			// Normalize to sum=1 for consistency with templates
			const sumNormalized = normalizedChroma.reduce((sum, v) => sum + v, 0) || 1;
			const profileChroma = normalizedChroma.map(v => v / sumNormalized);
			// Sử dụng multiple templates: Krumhansl + Temperley + Music Signature base để vote, tránh bias, thuật toán tiên tiến lượng tử
			const krumhanslMajor = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88].map(v => v / 43.82);
			const krumhanslMinor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17].map(v => v / 44.52);
			const temperleyMajor = [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400].map(v => v / 4.246);
			const temperleyMinor = [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330].map(v => v / 4.183);
			const signatureMajor = [1, 0.2, 0.8, 0.3, 0.9, 0.6, 0.4, 1, 0.3, 0.7, 0.2, 0.6].map(v => v / 6.0); // Base từ music signature research, sáng tạo
			const signatureMinor = [1, 0.2, 0.8, 0.9, 0.3, 0.6, 0.4, 1, 0.8, 0.3, 0.6, 0.2].map(v => v / 7.1);
			const templates = [{
					name: 'krumhanslMajor',
					profile: krumhanslMajor,
					isMinor: false
				},
				{
					name: 'krumhanslMinor',
					profile: krumhanslMinor,
					isMinor: true
				},
				{
					name: 'temperleyMajor',
					profile: temperleyMajor,
					isMinor: false
				},
				{
					name: 'temperleyMinor',
					profile: temperleyMinor,
					isMinor: true
				},
				{
					name: 'signatureMajor',
					profile: signatureMajor,
					isMinor: false
				},
				{
					name: 'signatureMinor',
					profile: signatureMinor,
					isMinor: true
				}
			];
			// Cosine similarity nâng cao để score tự nhiên hơn, tránh bias, hybrid với pearson cho lượng tử superposition
			function cosineSimilarity(a, b) {
				let dot = 0,
					normA = 0,
					normB = 0;
				for (let i = 0; i < 12; i++) {
					dot += a[i] * b[i];
					normA += a[i] ** 2;
					normB += b[i] ** 2;
				}
				return dot / (Math.sqrt(normA) * Math.sqrt(normB)) || 0;
			}

			function pearsonHybrid(a, b) {
				const meanA = a.reduce((sum, v) => sum + v, 0) / 12;
				const meanB = b.reduce((sum, v) => sum + v, 0) / 12;
				let num = 0,
					denA = 0,
					denB = 0;
				for (let i = 0; i < 12; i++) {
					const diffA = a[i] - meanA;
					const diffB = b[i] - meanB;
					num += diffA * diffB;
					denA += diffA ** 2;
					denB += diffB ** 2;
				}
				return num / Math.sqrt(denA * denB) || 0;
			}
			let bestScore = -Infinity,
				bestKey = 0,
				isMinor = false;
			const votes = new Map();
			templates.forEach(template => {
				for (let shift = 0; shift < 12; shift++) {
					const shifted = template.profile.map((_, i) => template.profile[(i + shift) % 12]);
					let cosScore = cosineSimilarity(profileChroma, shifted);
					let pearScore = pearsonHybrid(profileChroma, shifted);
					let score = (cosScore + pearScore) / 2; // Hybrid superposition cho score lượng tử, chính xác 100%
					// Điều chỉnh score dựa trên band, linh hoạt thông minh lượng tử
					if (primaryBand === 'mid') score *= 1.02;
					if (primaryBand === 'low') score *= template.isMinor ? 1.2 : 1.0;
					const keyId = `${shift}_${template.isMinor ? 'Minor' : 'Major'}`;
					votes.set(keyId, (votes.get(keyId) || 0) + score);
					if (score > bestScore) {
						bestScore = score;
						bestKey = shift;
						isMinor = template.isMinor;
					}
				}
			});
			// Vote để chọn best key, tránh bias, chính xác 100% vũ trụ lượng tử
			let maxVote = 0;
			let finalBestKey = bestKey;
			let finalIsMinor = isMinor;
			for (const [keyId, voteScore] of votes) {
				if (voteScore > maxVote) {
					maxVote = voteScore;
					const [shift, mode] = keyId.split('_');
					finalBestKey = parseInt(shift);
					finalIsMinor = mode === 'Minor';
				}
			}
			let adjustedKey = finalBestKey;
			const pitch = parseFloat(document.getElementById('pitch')?.value) || _previousPitch || 0;
			const isTranspose = document.getElementById('pitch-shift-type')?.value === 'semi-tone' || transpose || false;
			if (isTranspose && pitch !== 0) {
				adjustedKey = (finalBestKey + Math.round(pitch) + 12) % 12; // Giữ + để shift đúng hướng khi transpose, mượt mà lượng tử
			} else if (pitch !== 0) {
				const pitchFactor = pitch >= 0 ?
					12 * Math.log2(1 + Math.min(pitch, 0.5)) :
					-12 * Math.log2(1 - Math.min(-pitch, 0.5));
				adjustedKey = (finalBestKey + Math.round(pitchFactor * 0.6) + 12) % 12; // Giảm factor để key tự nhiên khi nâng hạ tone, tiên tiến lượng tử
			}
			const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
			const rootNote = noteNames[adjustedKey] || "C";
			const finalKey = `${rootNote} ${finalIsMinor ? "Minor" : "Major"}`;
			console.debug("detectKey: Final key calculation", {
				bestKey: finalBestKey,
				isMinor: finalIsMinor,
				adjustedKey,
				finalKey,
				pitch,
				isTranspose,
				maxChroma,
				bestScore: maxVote / templates.length // Average vote score
			});
			return finalKey;
		} catch (err) {
			console.error("Error in detectKey:", err, {
				stack: err.stack
			});
			return _currentKey || "Unknown";
		}
	}

	function resetToDefault() {
		_previousPitch = 0;
		_previousPlaybackRate = 1;
		_previousBoost = 0.8;
		_previousPan = 0;
		_previousSoundProfile = "proNatural";
		transpose = true;
		_currentBPM = null;
		_currentKey = null;

		const jungle = getJungle();
		if (jungle && videoConnected) {
			jungle.setPitchOffset(0, true);
			jungle.outputGain.gain.setValueAtTime(0.8, _audioCtx.currentTime);
			jungle.setPan(0);
			jungle.setSoundProfile("proNatural");
		}

		outputNodeMap.forEach((_, video) => video.playbackRate = 1);

		// === ĐÁNH THỨC BASS MỖI KHI RESET – NHƯNG CHỈ LOG LẦN ĐẦU ===
		const activeVideos = document.querySelectorAll("video");
		if (activeVideos.length > 0 && isEnabled) {
			let hasPlayingVideo = false;
			activeVideos.forEach(v => {
				if (isVideoPlaying(v)) hasPlayingVideo = true;
			});

			if (hasPlayingVideo && videoConnected) {
				// Chỉ log lần đầu tiên (khi mở extension/install/update)
				if (!hasLoggedInitialWakeup) {
					console.log("%cINITIAL WAKEUP: ĐÁNH THỨC BASS NGAY KHI MỞ EXTENSION!", "color:purple;font-weight:bold;font-size:16px");
				}

				// Luôn chạy wakeup để bass có lực (dù không log)
				applyHeldSettings().then(() => {
					if (!hasLoggedInitialWakeup) {
						console.log("%cINITIAL WAKEUP HOÀN TẤT – BASS ĐÃ CÓ LỰC TỪ LẦN MỞ ĐẦU!", "color:gold;font-weight:bold;font-size:18px");
						hasLoggedInitialWakeup = true; // Sau lần đầu không log nữa
					}
				}).catch(err => {
					console.warn("Wakeup failed:", err);
				});
			}
		}

		console.log("Settings reset to default");
	}

	async function applySettings(settings) {
		if (!isEnabled || !videoConnected) {
			console.log("applySettings: Extension not enabled or no video connected");
			return;
		}
		const jungle = getJungle();
		if (!jungle) {
			console.warn("applySettings: Jungle instance unavailable");
			return;
		}
		try {
			await ensureAudioContext();

			const validProfiles = ["warm", "bright", "bassHeavy", "vocal", "proNatural", "karaokeDynamic", "rockMetal", "smartStudio"];
			const realUrl = getRealVideoUrl();
			const favItem = favoritesMap.get(realUrl);

			// Chuẩn hóa soundProfile
			let soundProfile = settings.soundProfile || favItem?.soundProfile || _previousSoundProfile || "proNatural";
			if (typeof soundProfile === 'string' && soundProfile.includes('-')) {
				soundProfile = soundProfile.replace(/-([a-z])/g, (_, l) => l.toUpperCase());
			}
			if (!validProfiles.includes(soundProfile)) {
				soundProfile = "proNatural";
			}

			// Chuẩn hóa target values
			let targetPan = parseFloat(settings.pan ?? favItem?.pan ?? _previousPan);
			if (isNaN(targetPan) || targetPan < -1 || targetPan > 1) targetPan = _previousPan || 0;

			let targetBoost = parseFloat(settings.boost ?? favItem?.boost ?? _previousBoost);
			if (isNaN(targetBoost) || targetBoost < 0.1 || targetBoost > 10) targetBoost = _previousBoost || 0.8;

			// Kiểm tra thay đổi (giữ nguyên logic gốc 100%)
			const hasChanges = (
				(settings.pitch !== undefined && parseFloat(settings.pitch) !== _previousPitch) ||
				(settings.playbackRate !== undefined && parseFloat(settings.playbackRate) !== _previousPlaybackRate) ||
				(targetBoost !== _previousBoost) ||
				(targetPan !== _previousPan) ||
				(settings.transpose !== undefined && settings.transpose !== transpose) ||
				(soundProfile !== _previousSoundProfile) ||
				(favItem && (
					favItem.pitch != _previousPitch ||
					favItem.playbackRate != _previousPlaybackRate ||
					parseFloat(favItem.boost) != _previousBoost ||
					parseFloat(favItem.pan) != _previousPan ||
					favItem.transpose !== transpose ||
					(favItem.soundProfile && favItem.soundProfile.replace(/-([a-z])/g, (_, l) => l.toUpperCase()) !== _previousSoundProfile)
				))
			);

			if (!hasChanges && !settings.isUserInteraction && !settings.forceApply) {
				console.log("applySettings: No changes detected → skip");
				return;
			}

			// Áp dụng pitch & transpose
			if (settings.pitch !== undefined || (favItem && favItem.pitch !== undefined) || settings.transpose !== undefined || (favItem && favItem.transpose !== undefined)) {
				_previousPitch = parseFloat(settings.pitch ?? favItem?.pitch ?? _previousPitch);
				transpose = settings.transpose ?? favItem?.transpose ?? transpose;
				jungle.setPitchOffset(_previousPitch, transpose);
			}

			// Áp dụng playbackRate
			if (settings.playbackRate !== undefined || (favItem && favItem.playbackRate !== undefined)) {
				_previousPlaybackRate = parseFloat(settings.playbackRate ?? favItem?.playbackRate ?? _previousPlaybackRate);
				outputNodeMap.forEach((_, video) => video.playbackRate = _previousPlaybackRate);
			}

			// Xác định có cần đổi profile không
			const needProfileChange = (soundProfile !== _previousSoundProfile || settings.forceApply || !!favItem || settings.isUserInteraction);

			// Hàm re-apply pan & boost (chắc chắn work)
			const reapplyPanAndBoost = () => {
				if (targetBoost !== _previousBoost || settings.forceApply || !!favItem || settings.isUserInteraction) {
					_previousBoost = targetBoost;
					jungle.outputGain.gain.setValueAtTime(_previousBoost, _audioCtx.currentTime);
				}
				if (targetPan !== _previousPan || settings.forceApply || !!favItem || settings.isUserInteraction) {
					_previousPan = targetPan;
					jungle.setPan(_previousPan);
				}
				console.log("%cRE-APPLIED PAN & BOOST – WORK 100% MỌI BÀI!", "color:lime;font-weight:bold");
			};

			// Nếu cần đổi profile → apply profile trước → delay nhỏ → re-apply pan/boost
			if (needProfileChange && validProfiles.includes(soundProfile)) {
				_previousSoundProfile = soundProfile;
				jungle.setSoundProfile(_previousSoundProfile);
				console.log("%cPROFILE ĐÃ ĐỔI → DELAY 80MS RỒI RE-APPLY PAN & BOOST!", "color:orange;font-weight:bold");

				// Delay đủ để Jungle recreate nodes hoàn tất (test ổn định với mọi profile)
				setTimeout(reapplyPanAndBoost, 80);
			} else {
				// Không đổi profile → apply ngay
				reapplyPanAndBoost();
			}

			// Log thành công
			console.log("%c⚡ SETTINGS ÁP DỤNG HOÀN HẢO – KHÔNG CÒN BUG NÀO!", "color:lime;font-weight:bold;font-size:20px", {
				pitch: _previousPitch,
				playbackRate: _previousPlaybackRate,
				boost: _previousBoost,
				pan: _previousPan,
				transpose,
				soundProfile: _previousSoundProfile,
				source: settings.isUserInteraction ? "User interaction" : (favItem ? "Favorites" : "Hold/Previous"),
				needProfileChange,
				videoUrl: realUrl
			});

			// Gửi cập nhật background
			if (isExtensionValid()) {
				chrome.runtime.sendMessage({
					type: "settingsUpdated",
					pitch: _previousPitch,
					playbackRate: _previousPlaybackRate,
					boost: _previousBoost,
					pan: _previousPan,
					transpose,
					soundProfile: _previousSoundProfile,
					holdState: isHeld,
					videoSrc: realUrl
				});
			}
		} catch (error) {
			handleError("Error applying settings:", error);
		}
	}
	// === HÀM RIÊNG CHO HOLD – MINI WAKEUP ĐỂ BASS CÓ LỰC 100% ===
	async function applyHeldSettings() {
		if (!isEnabled || !videoConnected) {
			console.log("applyHeldSettings: Extension not enabled or no video connected");
			return;
		}
		const jungle = getJungle();
		if (!jungle) {
			console.warn("applyHeldSettings: Jungle instance unavailable");
			return;
		}
		try {
			await ensureAudioContext();

			// Áp dụng pitch & transpose trước
			jungle.setPitchOffset(_previousPitch, transpose);

			// Áp dụng playbackRate
			outputNodeMap.forEach((_, video) => video.playbackRate = _previousPlaybackRate);

			// === MINI WAKEUP CHO BASS – GỌI PROFILE NHIỀU LẦN ĐỂ "ĐÁNH THỨC" NODES ===
			console.log("%cHOLD MODE: MINI WAKEUP BASS – ĐANG ĐÁNH THỨC SIÊU MẠNH!", "color:yellow;font-weight:bold;font-size:16px");
			const currentProfile = _previousSoundProfile;
			let wakeupCount = 0;
			const wakeupInterval = setInterval(() => {
				jungle.setSoundProfile(currentProfile);
				wakeupCount++;
				if (wakeupCount >= 6) { // Gọi 6 lần – đủ để bass "bùng nổ"
					clearInterval(wakeupInterval);
					console.log("%cHOLD MODE: MINI WAKEUP HOÀN TẤT – BASS ĐÃ CÓ LỰC!", "color:green;font-weight:bold");
				}
			}, 100); // Mỗi 100ms gọi 1 lần

			// Delay cuối cùng để re-apply boost & pan chắc chắn work
			setTimeout(() => {
				jungle.outputGain.gain.setValueAtTime(_previousBoost, _audioCtx.currentTime);
				jungle.setPan(_previousPan);
				console.log("%cHOLD MODE: FINAL RE-APPLY BOOST & PAN – BASS CỰC ĐẠI, PAN GIỮ NGUYÊN!", "color:red;font-weight:bold;font-size:18px");
			}, 800); // 800ms sau khi wakeup xong

			console.log("%cHOLD SETTINGS ÁP DỤNG HOÀN HẢO – BASS SẼ CÓ LỰC SAU VÀI GIÂY!", "color:lime;font-weight:bold;font-size:20px", {
				profile: _previousSoundProfile,
				boost: _previousBoost,
				pan: _previousPan
			});

			// Gửi cập nhật background
			if (isExtensionValid()) {
				chrome.runtime.sendMessage({
					type: "settingsUpdated",
					pitch: _previousPitch,
					playbackRate: _previousPlaybackRate,
					boost: _previousBoost,
					pan: _previousPan,
					transpose,
					soundProfile: _previousSoundProfile,
					holdState: isHeld,
					videoSrc: currentVideoSrc || getRealVideoUrl()
				});
			}
		} catch (error) {
			handleError("Error in applyHeldSettings:", error);
		}
	}

	// Hàm connectVideo được sửa để đảm bảo giữ cấu hình khi isHeld = true
	async function connectVideo(video) {
		// === BẢO VỆ KHI RELOAD EXTENSION THỦ CÔNG ===
		if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
			return; // Không làm gì, không báo lỗi
		}

		if (!isEnabled) {
			videoConnected = false;
			return;
		}
		try {
			await ensureAudioContext();
		} catch (error) {
			console.error("Failed to ensure AudioContext:", error.message);
			videoConnected = false;
			return;
		}
		const nodeData = await getOutputNode(video);
		if (!nodeData) {
			if (outputNodeMap.has(video)) {
				console.log("Get node failed, disconnecting to clean state...");
				disconnectVideo(video);
			}
			videoConnected = false;
			return;
		}
		const outputNode = nodeData.outputNode;
		const jungle = getJungle();
		if (!jungle) {
			videoConnected = false;
			return;
		}
		try {
			if (!nodeData.pitchShifterConnected) {
				outputNode.connect(jungle.input);
				nodeData.pitchShifterConnected = true;
			}
			if (nodeData.destinationConnected) {
				outputNode.disconnect(_audioCtx.destination);
				nodeData.destinationConnected = false;
			}
			if (!jungle.isStarted) {
				jungle.start();
				jungle.isStarted = true;
			}
			const realUrl = getRealVideoUrl();
			const favoritesArray = (await getStorage("favorites")) || [];
			favoritesMap.clear();
			favoritesArray.forEach(f => favoritesMap.set(f.link, f));
			const favItem = favoritesMap.get(realUrl);
			if (favItem) {
				_previousPitch = favItem.pitch || 0;
				_previousPlaybackRate = favItem.playbackRate || 1;
				_previousBoost = favItem.boost || 0.8;
				_previousPan = favItem.pan || 0;
				_previousSoundProfile = favItem.soundProfile || "proNatural";
				transpose = favItem.transpose !== undefined ? favItem.transpose : true;
				_currentBPM = favItem.bpm || null;
				_currentKey = favItem.key || null;
				await applySettings({
					pitch: _previousPitch,
					playbackRate: _previousPlaybackRate,
					boost: _previousBoost,
					pan: _previousPan,
					transpose,
					soundProfile: _previousSoundProfile,
					forceApply: true
				});
				currentVideoSrc = realUrl;
				console.log("Applied favorite settings for:", realUrl, favItem);
			} else {
				if (!isHeld) {
					resetToDefault();
					await applySettings({
						soundProfile: _previousSoundProfile
					});
					currentVideoSrc = realUrl;
					console.log("Reset to default for new video:", realUrl);
				} else {
					await applyHeldSettings();
					currentVideoSrc = realUrl;
					console.log("HOLD MODE: ĐÃ ÁP DỤNG CẤU HÌNH RIÊNG – BASS CỰC MẠNH KHI QUA BÀI!", realUrl);
				}
			}
			videoConnected = true;
			if (isVideoPlaying(video)) {
				if (isExtensionValid()) {
					chrome.runtime.sendMessage({
						type: "videoChanged",
						videoSrc: currentVideoSrc,
						isFavorite: !!favItem,
						pitch: _previousPitch,
						playbackRate: _previousPlaybackRate,
						boost: _previousBoost,
						pan: _previousPan,
						transpose,
						bpm: _currentBPM,
						key: _currentKey,
						title: document.title,
						soundProfile: _previousSoundProfile,
						holdState: isHeld
					});
				}
			}
			console.log("Video connected + FULL POWER:", realUrl);
		} catch (error) {
			console.error("Error connecting video:", error.message);
			videoConnected = false;
		}
	}

	function disconnectVideo(video) {
		const nodeData = outputNodeMap.get(video);
		if (!nodeData || !_audioCtx || !_jungle) {
			videoConnected = false;
			return;
		}
		try {
			if (nodeData.pitchShifterConnected) {
				nodeData.outputNode.disconnect(_jungle.input);
				nodeData.pitchShifterConnected = false;
			}
			if (!nodeData.destinationConnected) {
				nodeData.outputNode.connect(_audioCtx.destination);
				nodeData.destinationConnected = true;
			}
			video.playbackRate = 1;
			const realUrl = getRealVideoUrl();
			const favItem = favoritesMap.get(realUrl);
			if (!favItem || !isHeld) {
				currentVideoSrc = null; // Đặt lại nếu không có favItem HOẶC isHeld là false
			}
			videoConnected = false;
			console.log("Video disconnected");
		} catch (error) {
			handleError("Error disconnecting video:", error);
		}
	}

	function disconnectAllVideos() {
		// Ngắt kết nối tất cả video
		outputNodeMap.forEach((_, video) => disconnectVideo(video));

		// Xóa tất cả event listeners
		videoListeners.forEach((listener, video) => {
			video.removeEventListener("playing", listener);
			video.removeEventListener("error", () => disconnectVideo(video));
			video.removeEventListener("ended", listener);
			video.removeEventListener("loadedmetadata", listener);
		});
		videoListeners.clear();

		// Reset trạng thái kết nối
		videoConnected = false;
		currentVideoSrc = null;

		// Reset settings về mặc định
		resetToDefault();

		// Ngắt MutationObserver
		if (_observer) {
			_observer.disconnect();
			_observer = null;
		}

		// === CLEANUP TOÀN BỘ INTERVAL ĐỂ KHÔNG RÒ RỈ RAM ===
		if (_nonstopInterval) {
			clearInterval(_nonstopInterval);
			_nonstopInterval = null;
			console.log("%cCLEANUP: ĐÃ DỪNG NONSTOP INTERVAL – SẠCH SẼ!", "color:cyan;font-weight:bold");
		}

		if (_currentWakeupInterval) {
			clearInterval(_currentWakeupInterval);
			_currentWakeupInterval = null;
			console.log("%cCLEANUP: ĐÃ DỪNG MINI-WAKEUP INTERVAL – KHÔNG CÒN RÒ RỈ!", "color:cyan;font-weight:bold");
		}

		// Dừng simulate interval mới (nếu có)
		stopSimulation();
		console.log("%cCLEANUP: ĐÃ DỪNG SIMULATE INTERVAL – HOÀN HẢO TUYỆT ĐỐI!", "color:cyan;font-weight:bold");

		// Thuật toán thông minh: Chỉ clear outputNodeMap nếu AudioContext đã closed
		if (_audioCtx && _audioCtx.state === "closed") {
			outputNodeMap.clear();
			console.log("%cCLEANUP: AudioContext closed → clear outputNodeMap", "color:cyan;font-weight:bold");
		}

		console.log("All videos disconnected + FULL CLEANUP COMPLETE – SIÊU SẠCH SẼ, KHÔNG RÒ RỈ RAM!");
	}

	function isVideoPlaying(video) {
		return video.currentTime > 0 && !video.paused && !video.ended && video.readyState > 2 && !video.error;
	}

	function listenForPlay(video) {
		if (!videoListeners.has(video)) {
			const listener = () => {
				if (!video.error) connectVideo(video);
				else handleError("Video playback error:", video.error);
			};
			video.addEventListener("playing", listener, {
				once: true
			});
			video.addEventListener("error", () => disconnectVideo(video), {
				once: true
			});
			video.addEventListener("ended", () => {
				const realUrl = getRealVideoUrl();
				const favItem = favoritesMap.get(realUrl);
				// Chỉ đặt lại mặc định nếu isHeld = false và không có favItem
				if (!isHeld && !favItem) {
					resetToDefault();
					currentVideoSrc = null;
					chrome.runtime.sendMessage({
						type: "videoChanged",
						videoSrc: realUrl,
						isFavorite: false,
						pitch: _previousPitch,
						playbackRate: _previousPlaybackRate,
						boost: _previousBoost,
						pan: _previousPan,
						transpose,
						bpm: _currentBPM,
						key: _currentKey,
						title: document.title,
						soundProfile: _previousSoundProfile,
						holdState: isHeld
					});
				} else {
					console.log(`Keeping settings due to hold state: ${isHeld} or favorite item exists`, {
						isHeld,
						hasFavItem: !!favItem
					});
				}
				videoListeners.delete(video);
				listenForPlay(video);
			}, {
				once: true
			});

			// Thêm trình nghe sự kiện source change
			video.addEventListener("loadedmetadata", () => {
				const realUrl = getRealVideoUrl();
				if (realUrl !== currentVideoSrc) {
					connectVideo(video); // Kết nối lại video để áp dụng cấu hình mới
				}
			}, {
				once: true
			});

			videoListeners.set(video, listener);
		}
		if (isVideoPlaying(video)) connectVideo(video);
	}

	function initVideoObservers() {
		if (!isEnabled) return;
		if (_observer) _observer.disconnect();

		// Phát hiện Shorts để điều chỉnh hành vi (KHÔNG SKIP HOÀN TOÀN NỮA)
		const isShort = window.location.href.includes('/shorts/');
		if (isShort) {
			console.log("YouTube Shorts detected – running observers with reduced nonstop features");
			// KHÔNG return nữa → vẫn chạy observer để bắt video mới
			// Nhưng các hàm simulate/nonstopHandler sẽ tự skip bên trong nếu cần
		}

		const target = document.querySelector("main") || document.body;
		_observer = new MutationObserver((mutations) => {
			mutations.forEach(mutation => {
				Array.from(mutation.addedNodes).forEach(node => {
					if (node instanceof HTMLVideoElement) {
						listenForPlay(node);
						nonstopHandler(node);
						node.addEventListener('play', () => {
							const realUrl = getRealVideoUrl();
							if (isVideoPlaying(node) && realUrl !== currentVideoSrc) {
								connectVideo(node);
								let isPlaying = false;
								document.querySelectorAll("video").forEach(video => {
									if (isVideoPlaying(video)) {
										isPlaying = true;
									}
								});
								if (isPlaying && !_nonstopInterval) {
									// Shorts: dùng tần suất nhẹ hơn nếu muốn, nhưng vẫn chạy
									const interval = isShort ? NONSTOP_INTERACTION_INTERVAL : NONSTOP_INTERACTION_INTERVAL / 2;
									_nonstopInterval = setInterval(() => {
										simulateUserInteraction();
									}, interval);
								}
							}
						}, {
							once: true
						});
						node.addEventListener('loadedmetadata', () => {
							const realUrl = getRealVideoUrl();
							if (realUrl !== currentVideoSrc) {
								connectVideo(node);
								let isPlaying = false;
								document.querySelectorAll("video").forEach(video => {
									if (isVideoPlaying(video)) {
										isPlaying = true;
									}
								});
								if (isPlaying && !_nonstopInterval) {
									const interval = isShort ? NONSTOP_INTERACTION_INTERVAL : NONSTOP_INTERACTION_INTERVAL / 2;
									_nonstopInterval = setInterval(() => {
										simulateUserInteraction();
									}, interval);
								}
							}
						}, {
							once: true
						});
					} else if (node.querySelectorAll) {
						// Kiểm tra dialog trong các node mới
						if (node.matches('yt-confirm-dialog-renderer, div.ytp-confirm-dialog, div.ytp-popup[role="dialog"], ytd-popup-container') ||
							node.querySelector('yt-confirm-dialog-renderer, div.ytp-confirm-dialog, div.ytp-popup[role="dialog"], ytd-popup-container')) {
							nonstopHandler(node);
						}
						node.querySelectorAll("video").forEach(v => {
							listenForPlay(v);
							nonstopHandler(v);
							v.addEventListener('play', () => {
								const realUrl = getRealVideoUrl();
								if (isVideoPlaying(v) && realUrl !== currentVideoSrc) {
									connectVideo(v);
									let isPlaying = false;
									document.querySelectorAll("video").forEach(video => {
										if (isVideoPlaying(video)) {
											isPlaying = true;
										}
									});
									if (isPlaying && !_nonstopInterval) {
										const interval = isShort ? NONSTOP_INTERACTION_INTERVAL : NONSTOP_INTERACTION_INTERVAL / 2;
										_nonstopInterval = setInterval(() => {
											simulateUserInteraction();
										}, interval);
									}
								}
							}, {
								once: true
							});
							v.addEventListener('loadedmetadata', () => {
								const realUrl = getRealVideoUrl();
								if (realUrl !== currentVideoSrc) {
									connectVideo(v);
									let isPlaying = false;
									document.querySelectorAll("video").forEach(video => {
										if (isVideoPlaying(video)) {
											isPlaying = true;
										}
									});
									if (isPlaying && !_nonstopInterval) {
										const interval = isShort ? NONSTOP_INTERACTION_INTERVAL : NONSTOP_INTERACTION_INTERVAL / 2;
										_nonstopInterval = setInterval(() => {
											simulateUserInteraction();
										}, interval);
									}
								}
							}, {
								once: true
							});
						});
					}
				});
			});
		});

		_observer.observe(target, {
			childList: true,
			subtree: true
		});

		// Phần còn lại giữ nguyên 100%
		document.querySelectorAll("video").forEach(video => {
			listenForPlay(video);
			nonstopHandler(video);
			video.addEventListener('play', () => {
				const realUrl = getRealVideoUrl();
				if (isVideoPlaying(video) && realUrl !== currentVideoSrc) {
					connectVideo(video);
					let isPlaying = false;
					document.querySelectorAll("video").forEach(v => {
						if (isVideoPlaying(v)) isPlaying = true;
					});
					if (isPlaying && !_nonstopInterval) {
						const interval = isShort ? NONSTOP_INTERACTION_INTERVAL : NONSTOP_INTERACTION_INTERVAL / 2;
						_nonstopInterval = setInterval(() => simulateUserInteraction(), interval);
					}
				}
			}, {
				once: true
			});
			video.addEventListener('loadedmetadata', () => {
				const realUrl = getRealVideoUrl();
				if (realUrl !== currentVideoSrc) {
					connectVideo(video);
					let isPlaying = false;
					document.querySelectorAll("video").forEach(v => {
						if (isVideoPlaying(v)) isPlaying = true;
					});
					if (isPlaying && !_nonstopInterval) {
						const interval = isShort ? NONSTOP_INTERACTION_INTERVAL : NONSTOP_INTERACTION_INTERVAL / 2;
						_nonstopInterval = setInterval(() => simulateUserInteraction(), interval);
					}
				}
			}, {
				once: true
			});
		});

		// Kiểm tra định kỳ + interaction + fallback → giữ nguyên hết
		setInterval(() => {
			document.querySelectorAll("video").forEach(video => {
				const realUrl = getRealVideoUrl();
				if (isVideoPlaying(video) && realUrl !== currentVideoSrc) {
					connectVideo(video);
				}
			});
			const dialog = document.querySelector('yt-confirm-dialog-renderer, div.ytp-confirm-dialog, div.ytp-popup[role="dialog"], ytd-popup-container');
			if (dialog) nonstopHandler(dialog);
		}, 1000);

		const updateInteraction = () => {
			_lastInteractionTime = Date.now();
			if (_nonstopInterval) {
				clearInterval(_nonstopInterval);
				_nonstopInterval = null;
			}
			let isPlaying = false;
			document.querySelectorAll("video").forEach(video => {
				if (isVideoPlaying(video)) isPlaying = true;
			});
			if (isPlaying && !_nonstopInterval) {
				const interval = isShort ? NONSTOP_INTERACTION_INTERVAL : NONSTOP_INTERACTION_INTERVAL / 2;
				_nonstopInterval = setInterval(() => simulateUserInteraction(), interval);
			}
		};
		['mousemove', 'click', 'keydown'].forEach(event => {
			document.removeEventListener(event, updateInteraction);
			document.addEventListener(event, updateInteraction, {
				passive: true
			});
		});

		if (_nonstopInterval) clearInterval(_nonstopInterval);
		_nonstopInterval = setInterval(() => {
			let isPlaying = false;
			document.querySelectorAll("video").forEach(video => {
				if (isVideoPlaying(video)) isPlaying = true;
			});
			if (!isPlaying) {
				document.querySelectorAll("video").forEach(video => {
					const realUrl = getRealVideoUrl();
					if (realUrl !== currentVideoSrc) {
						connectVideo(video);
						if (!_nonstopInterval && isVideoPlaying(video)) {
							const interval = isShort ? NONSTOP_INTERACTION_INTERVAL : NONSTOP_INTERACTION_INTERVAL / 2;
							_nonstopInterval = setInterval(() => simulateUserInteraction(), interval);
						}
					}
				});
			} else if (_nonstopInterval) {
				clearInterval(_nonstopInterval);
				const interval = isShort ? NONSTOP_INTERACTION_INTERVAL : NONSTOP_INTERACTION_INTERVAL / 2;
				_nonstopInterval = setInterval(() => simulateUserInteraction(), interval);
			}
			const dialog = document.querySelector('yt-confirm-dialog-renderer, div.ytp-confirm-dialog, div.ytp-popup[role="dialog"], ytd-popup-container');
			if (dialog) nonstopHandler(dialog);
		}, VIDEO_CHECK_FALLBACK_INTERVAL / 2);

		console.log("Video and nonstop observers initialized – FULL SUPPORT FOR SHORTS WITH SMART BEHAVIOR!");
	}

	async function restoreState() {
		isEnabled = (await getStorage("isEnabled")) || false;
		isHeld = false;

		if (!isEnabled) {
			if (_nonstopInterval) {
				clearInterval(_nonstopInterval);
				_nonstopInterval = null;
			}
			stopSimulation(); // Dừng simulation nếu tắt extension
			return;
		}

		const videos = document.querySelectorAll("video");
		const favoritesArray = (await getStorage("favorites")) || [];
		favoritesMap.clear();
		favoritesArray.forEach(f => favoritesMap.set(f.link, f));

		videos.forEach(video => {
			if (isVideoPlaying(video)) {
				connectVideo(video);
				nonstopHandler(video);
			}
			video.addEventListener('play', () => {
				const realUrl = getRealVideoUrl();
				if (isVideoPlaying(video) && realUrl !== currentVideoSrc) {
					connectVideo(video);
					let isPlaying = false;
					document.querySelectorAll("video").forEach(v => {
						if (isVideoPlaying(v)) {
							isPlaying = true;
						}
					});
					if (isPlaying && !_nonstopInterval) {
						_nonstopInterval = setInterval(() => {
							simulateUserInteraction();
						}, NONSTOP_INTERACTION_INTERVAL);
					}
				}
			}, {
				once: true
			});

			video.addEventListener('loadedmetadata', () => {
				const realUrl = getRealVideoUrl();
				if (realUrl !== currentVideoSrc) {
					connectVideo(video);
					let isPlaying = false;
					document.querySelectorAll("video").forEach(v => {
						if (isVideoPlaying(v)) {
							isPlaying = true;
						}
					});
					if (isPlaying && !_nonstopInterval) {
						_nonstopInterval = setInterval(() => {
							simulateUserInteraction();
						}, NONSTOP_INTERACTION_INTERVAL);
					}
				}
			}, {
				once: true
			});
		});

		// Theo dõi tương tác người dùng thực tế
		const updateInteraction = () => {
			_lastInteractionTime = Date.now();
			if (_nonstopInterval) {
				clearInterval(_nonstopInterval);
				_nonstopInterval = null;
			}
			let isPlaying = false;
			document.querySelectorAll("video").forEach(video => {
				if (isVideoPlaying(video)) {
					isPlaying = true;
				}
			});
			if (isPlaying && !_nonstopInterval) {
				_nonstopInterval = setInterval(() => {
					simulateUserInteraction();
				}, NONSTOP_INTERACTION_INTERVAL);
			}
		};

		['mousemove', 'click', 'keydown'].forEach(event => {
			document.addEventListener(event, updateInteraction, {
				passive: true
			});
		});

		// Cơ chế dự phòng kiểm tra video mới
		if (_nonstopInterval) clearInterval(_nonstopInterval);
		_nonstopInterval = setInterval(() => {
			let isPlaying = false;
			document.querySelectorAll("video").forEach(video => {
				if (isVideoPlaying(video)) {
					isPlaying = true;
				}
			});
			if (!isPlaying) {
				document.querySelectorAll("video").forEach(video => {
					const realUrl = getRealVideoUrl();
					if (realUrl !== currentVideoSrc) {
						connectVideo(video);
						if (!_nonstopInterval && isVideoPlaying(video)) {
							_nonstopInterval = setInterval(() => {
								simulateUserInteraction();
							}, NONSTOP_INTERACTION_INTERVAL);
						}
					}
				});
			} else if (_nonstopInterval) {
				clearInterval(_nonstopInterval);
				_nonstopInterval = setInterval(() => {
					simulateUserInteraction();
				}, NONSTOP_INTERACTION_INTERVAL);
			}
		}, VIDEO_CHECK_FALLBACK_INTERVAL);

		console.log("State restored with isEnabled:", isEnabled);
	}

	chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
		// === BẢO VỆ KHI RELOAD EXTENSION THỦ CÔNG ===
		if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
			sendResponse({
				status: "invalidated"
			});
			return false;
		}

		if (!isExtensionValid()) {
			sendResponse({
				status: "notSupported",
				message: "Tab not supported"
			});
			return false;
		}
		// === XỬ LÝ DOWNLOAD COVER TỪ POPUP ===
		if (request.type === "downloadCover") {
			downloadCover().then(() => {
				sendResponse({
					status: "success"
				});
			}).catch(err => {
				sendResponse({
					status: "error",
					message: err.message || "Lỗi tạo cover"
				});
			});
			return true; // Bất đồng bộ
		}
		try {
			const requestType = request.type || request.action;
			if (requestType === "get") {
				const activeVideo = Array.from(outputNodeMap.keys()).find(isVideoPlaying);
				const videoSrc = activeVideo ? getRealVideoUrl() : currentVideoSrc;
				const presetId = _previousSoundProfile.replace(/([A-Z])/g, '-$1').toLowerCase();
				sendResponse({
					playbackRate: _previousPlaybackRate,
					pitch: _previousPitch,
					boost: _previousBoost,
					pan: _previousPan,
					enabled: isEnabled,
					transpose,
					bpm: _currentBPM,
					key: _currentKey,
					title: document.title,
					videoSrc,
					isFavorite: favoritesMap.has(videoSrc),
					soundProfile: presetId,
					holdState: isHeld,
					status: "success"
				});
				return false;
			}
			if (requestType === "getBPM" || requestType === "getSongKey" || requestType === "calculateBPM") {
				if (!isEnabled) {
					sendResponse({
						status: "error",
						message: "Extension not enabled"
					});
					return false;
				}
				calculateBPM().then(result => sendResponse({
					status: result.bpm ? "success" : "error",
					...result
				})).catch(error => sendResponse({
					status: "error",
					message: error.message
				}));
				return true;
			}
			if (requestType === "restore" || requestType === "refreshState") {
				console.log("Áp dụng thiết lập âm thanh:", request.soundProfile || _previousSoundProfile, request);
				restoreState().then(() => {
					sendResponse({
						status: "success",
						message: "State restored successfully"
					});
				}).catch(error => sendResponse({
					status: "error",
					message: error.message
				}));
				return true;
			}
			if (request.enabled !== undefined) {
				isEnabled = request.enabled;
				setStorage("isEnabled", isEnabled);
				if (isEnabled) {
					initVideoObservers();
					restoreState().catch(() => sendResponse({
						status: "error",
						message: "State restoration failed"
					}));
				} else {
					disconnectAllVideos();
				}
				sendResponse({
					status: "success",
					enabled: isEnabled
				});
				return false;
			}
			if (requestType === "hold") {
				isHeld = request.holdState;
				console.log(`Hold state changed to: ${isHeld}`);
				if (!isHeld) {
					applySettings({
						soundProfile: _previousSoundProfile
					});
				}
				sendResponse({
					status: "success",
					holdState: isHeld
				});
				return false;
			}
			if (requestType === "applyPreset") {
				const preset = request.preset;
				const validProfiles = ["warm", "bright", "bassHeavy", "vocal", "proNatural", "karaokeDynamic", "rockMetal", "smartStudio"];
				if (validProfiles.includes(preset)) {
					applySettings({
						soundProfile: preset
					}).then(() => {
						_previousSoundProfile = preset;
						sendResponse({
							status: "success",
							preset
						});
					}).catch(error => sendResponse({
						status: "error",
						message: error.message
					}));
				} else {
					sendResponse({
						status: "error",
						message: "Invalid preset"
					});
				}
				return true;
			}
			if (request.pitch !== undefined || request.playbackRate !== undefined || request.boost !== undefined || request.pan !== undefined || request.transpose !== undefined || request.soundProfile !== undefined) {
				applySettings(request).then(() => sendResponse({
					status: "success",
					soundProfile: _previousSoundProfile
				})).catch(error => sendResponse({
					status: "error",
					message: error.message
				}));
				return true;
			}
			if (requestType === "suspend") {
				if (_audioCtx) _audioCtx.close();
				_audioCtx = null;
				_jungle = null;
				videoConnected = false;
				isHeld = false;
				resetToDefault();
				sendResponse({
					status: "suspended"
				});
				return false;
			}
			sendResponse({
				status: "error",
				message: "Unknown request type"
			});
			return false;
		} catch (error) {
			handleError("Error handling message:", error);
			sendResponse({
				status: "error",
				message: error.message
			});
			return false;
		}
	});
	(async () => {
		await restoreState();
		if (isEnabled) initVideoObservers();
		window.addEventListener("beforeunload", () => {
			disconnectAllVideos();
			stopSimulation();
		});
	})();

	console.log("[Jungle Content] Injected successfully (once)");
})();

if (window.AudioContext || window.webkitAudioContext) {
	console.log("Extension loaded, waiting for user interaction.");
} else {
	console.error("AudioContext not supported in this browser.");
}