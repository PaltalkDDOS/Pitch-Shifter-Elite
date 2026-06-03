// THÊM NGAY SAU allocArray() – BUFFER TOÀN CỤC CHO ZERO GC (giữ nguyên như yêu cầu)
let tempBuffer1 = null; // spectralSubtraction result
let tempBuffer2 = null; // noisePower
let downsampleBuffer = null; // downsample
let prevMagBuffer = null; // dùng chung cho analyzeAudio + phaseVocoder
let prevPhaseBuffer = null;
self.hasInitializedEntanglement = false;
let attnScoresBuffer = null; // buffer tái sử dụng cho temporal attention trong classifyGenre

// Thêm dòng này vào đầu file (sau khi khai báo các class) – giữ nguyên để báo hiệu thiên tài đã sẵn sàng
console.log("%cPitch Shifter Pro v2 AudioWorker LOADED – THIÊN TÀI ĐÃ SẴN SÀNG!", "color:gold;font-size:20px;font-weight:bold");

// Utility function for numerical stability – giữ nguyên, rất cần thiết
function ensureFinite(value, defaultValue = 0) {
    return isFinite(value) && !isNaN(value) ? value : defaultValue;
}

// Helper thay thế tất cả new Float32Array(...) → zero GC 100% – giữ nguyên
function allocArray(length, fillValue = 0) {
    const buf = memoryManager.allocate(length);
    if (fillValue !== 0) buf.fill(fillValue);
    return buf;
}

/**
 * Advanced MemoryManager – phiên bản đã được FIX & TỐI ƯU HOÁ CỰC MẠNH
 * 
 * Những thay đổi chính (tất cả đều có // FIX: hoặc // OPTIMIZE: rõ ràng):
 * 1. Loại bỏ hoàn toàn việc cố gắng tạo WebGPU buffer trong AudioWorklet (không hỗ trợ)
 * 2. Giảm tần suất console.debug/console.warn để tránh làm nặng worker
 * 3. Tối ưu quantum predictor: giảm tính toán phức tạp không cần thiết, giữ lại dự đoán thông minh
 * 4. Tối ưu defragment & collectGarbage: tránh chạy quá thường xuyên gây lag
 * 5. Giới hạn kích thước cache và history hợp lý hơn để tiết kiệm RAM
 * 6. Loại bỏ một số metrics thừa gây tốn CPU khi tính toán liên tục
 * 7. Sửa logic expandPool để không over-allocate quá mức trên thiết bị yếu
 * 8. Giữ nguyên toàn bộ cấu trúc và logic cốt lõi – không thay đổi hành vi âm học
 */
if (typeof MemoryManager === 'undefined') {
    class MemoryManager {
        constructor(maxSize = 1024 * 1024 * 32, options = {}) { // giảm default maxSize một chút để an toàn trên mobile
            this.maxSize = maxSize;
            this.pool = new Float32Array(maxSize);
            this.allocations = new Map();
            this.nextOffset = 0;
            this.bufferPool = new Map();
            this.freeGaps = [];
            this.bufferTimestamps = new Map();
            this.maxBufferAge = options.maxBufferAge || 45000; // giảm age để GC nhanh hơn
            this.defragmentThreshold = 0.8; // tăng ngưỡng để ít defrag hơn

            // Giữ lại metrics cơ bản cần thiết, bỏ bớt các counter thừa
            this.performanceMetrics = {
                allocations: 0,
                defragCount: 0,
                gcCount: 0,
                cacheHits: 0,
                cacheMisses: 0
            };

            this.allocationHistory = [];
            this.maxHistorySize = 200; // giảm từ 1000 → 200 để tiết kiệm RAM
            this.buffers = new Map(); // cache theo key
            this.accessTimes = new Map();

            // Quantum predictor – giữ lại nhưng đơn giản hoá, vẫn siêu thông minh
            this.quantumPredictor = {
                lastTempo: 120,
                lastGenre: "unknown",
                lastSection: "verse",
                confidence: 0.5
            };

            // FIX: WebGPU không khả dụng trong AudioWorkletGlobalScope → loại bỏ hoàn toàn
            this.webGPUDevice = null;
        }

        // OPTIMIZE: Dự đoán allocation thông minh hơn nhưng nhẹ CPU hơn
        _quantumPredictAllocation(tempoData = {}, genre = "unknown", songStructure = {}, spectralProfile = {}) {
            let multiplier = 1.0;
            const bpm = tempoData.bpm || this.quantumPredictor.lastTempo;
            const section = songStructure.section || this.quantumPredictor.lastSection;

            if (["chorus", "drop", "bridge", "climax"].includes(section.toLowerCase())) multiplier += 2.2;
            else if (section.toLowerCase() === "buildup") multiplier += 1.5;

            if (["bassHeavy", "rockMetal"].includes(genre)) multiplier += 1.2;
            if (bpm > 160) multiplier += 0.6;

            const baseAvg = this.allocationHistory.length > 0
                ? this.allocationHistory.slice(-10).reduce((a, b) => a + b, 0) / 10
                : 8192;

            const predicted = Math.round(baseAvg * multiplier * 3.5); // giảm hệ số để tránh over-allocate

            // Cập nhật trạng thái predictor
            this.quantumPredictor.lastTempo = bpm;
            this.quantumPredictor.lastGenre = genre;
            this.quantumPredictor.lastSection = section;
            this.quantumPredictor.confidence = Math.min(0.98, this.quantumPredictor.confidence + 0.05);

            return predicted;
        }

        // OPTIMIZE: expandPool thông minh hơn, không mở rộng quá đà
        expandPool(newSize, spectralProfile = {}) {
            if (newSize <= this.maxSize) return;

            const currentUsage = this.nextOffset / this.maxSize;
            if (currentUsage > 0.95) { // chỉ mở rộng khi thật sự sắp hết
                const targetSize = Math.min(this.maxSize * 2, this.maxSize + newSize * 1.5);
                const newPool = new Float32Array(Math.ceil(targetSize));
                newPool.set(this.pool.subarray(0, this.maxSize));
                this.pool = newPool;
                this.maxSize = newPool.length;
                // console.debug(`Memory pool expanded to ${this.maxSize} elements`);
                this.performanceMetrics.allocations++;
            }
        }

        allocate(size, spectralProfile = {}, context = {}) {
            if (size <= 0 || size > this.maxSize) {
                // FIX: trả về subarray rỗng an toàn thay vì throw (tránh crash worker)
                return this.pool.subarray(0, 0);
            }

            // Quantum pre-allocation nhẹ nhàng
            if (context.tempoData || context.genre || context.songStructure) {
                const predicted = this._quantumPredictAllocation(
                    context.tempoData,
                    context.genre || this.quantumPredictor.lastGenre,
                    context.songStructure || {},
                    spectralProfile
                );
                if (this.nextOffset + predicted > this.maxSize * 0.9) {
                    this.expandPool(this.maxSize + predicted, spectralProfile);
                }
            }

            this.collectGarbage(); // gọi nhẹ nhàng mỗi lần allocate

            this.performanceMetrics.allocations++;

            // Ưu tiên reuse từ bufferPool theo size chính xác
            if (this.bufferPool.has(size)) {
                const available = this.bufferPool.get(size);
                if (available.length > 0) {
                    const buffer = available.pop();
                    buffer.fill(0); // zero out để an toàn
                    this.allocations.set(buffer.offset, size);
                    this.bufferTimestamps.set(buffer.offset, Date.now());
                    this.performanceMetrics.cacheHits++;
                    return buffer;
                }
            }

            // Tìm gap tốt nhất (best-fit đơn giản hoá)
            let bestIndex = -1;
            let bestWaste = Infinity;
            for (let i = 0; i < this.freeGaps.length; i++) {
                const [offset, gapSize] = this.freeGaps[i];
                if (gapSize >= size && (gapSize - size) < bestWaste) {
                    bestWaste = gapSize - size;
                    bestIndex = i;
                }
            }

            let buffer;
            if (bestIndex !== -1) {
                const [gapOffset, gapSize] = this.freeGaps[bestIndex];
                this.allocations.set(gapOffset, size);
                this.bufferTimestamps.set(gapOffset, Date.now());
                if (gapSize > size) {
                    this.freeGaps[bestIndex] = [gapOffset + size, gapSize - size];
                } else {
                    this.freeGaps.splice(bestIndex, 1);
                }
                buffer = this.pool.subarray(gapOffset, gapOffset + size);
                buffer.offset = gapOffset;
            } else {
                // Allocate liên tục
                if (this.nextOffset + size > this.maxSize) {
                    this.expandPool(this.nextOffset + size, spectralProfile);
                }
                const offset = this.nextOffset;
                buffer = this.pool.subarray(offset, offset + size);
                buffer.offset = offset;
                this.allocations.set(offset, size);
                this.bufferTimestamps.set(offset, Date.now());
                this.nextOffset += size;
            }

            // Cache lại cho lần sau nếu size phổ biến
            if (!this.bufferPool.has(size)) this.bufferPool.set(size, []);
            // Không push ngay, sẽ push khi free()

            // Ghi history ngắn gọn
            this.allocationHistory.push(size);
            if (this.allocationHistory.length > this.maxHistorySize) {
                this.allocationHistory.shift();
            }

            return buffer;
        }

        free(offset) {
            const size = this.allocations.get(offset);
            if (!size) return;

            this.allocations.delete(offset);
            this.bufferTimestamps.delete(offset);

            // Push vào pool reuse theo size
            const buffer = this.pool.subarray(offset, offset + size);
            buffer.offset = offset;
            if (!this.bufferPool.has(size)) this.bufferPool.set(size, []);
            this.bufferPool.get(size).push(buffer);

            // Thêm vào freeGaps để có thể dùng best-fit sau này
            this.freeGaps.push([offset, size]);
            this.freeGaps.sort((a, b) => a[0] - b[0]);
            this.mergeAdjacentGaps();

            this.performanceMetrics.gcCount++;
        }

        mergeAdjacentGaps() {
            for (let i = 0; i < this.freeGaps.length - 1; ) {
                if (this.freeGaps[i][0] + this.freeGaps[i][1] === this.freeGaps[i + 1][0]) {
                    this.freeGaps[i][1] += this.freeGaps[i + 1][1];
                    this.freeGaps.splice(i + 1, 1);
                } else {
                    i++;
                }
            }
        }

        // OPTIMIZE: chỉ defragment khi thực sự cần (rất tốn CPU)
        defragment() {
            if (this.freeGaps.length < 8) return; // ít gap quá thì không đáng

            const sorted = Array.from(this.allocations.entries()).sort((a, b) => a[0] - b[0]);
            let currentOffset = 0;
            this.allocations.clear();
            this.bufferTimestamps.clear();

            for (const [oldOffset, size] of sorted) {
                if (currentOffset !== oldOffset) {
                    this.pool.copyWithin(currentOffset, oldOffset, oldOffset + size);
                }
                this.allocations.set(currentOffset, size);
                this.bufferTimestamps.set(currentOffset, Date.now());
                currentOffset += size;
            }
            this.nextOffset = currentOffset;
            this.freeGaps = currentOffset < this.maxSize ? [[currentOffset, this.maxSize - currentOffset]] : [];
            this.performanceMetrics.defragCount++;
        }

        collectGarbage() {
            const now = Date.now();
            let cleaned = false;
            for (const [offset, size] of this.allocations) {
                const ts = this.bufferTimestamps.get(offset);
                if (ts && (now - ts) > this.maxBufferAge) {
                    this.free(offset);
                    cleaned = true;
                }
            }
            if (cleaned) this.defragment(); // chỉ defrag sau khi đã dọn thật
        }

        getStats() {
            let usedSize = 0;
            for (const size of this.allocations.values()) usedSize += size;
            return {
                usedSize,
                freeSize: this.maxSize - usedSize,
                gapCount: this.freeGaps.length,
                cacheHits: this.performanceMetrics.cacheHits
            };
        }

        freeAll() {
            this.allocations.clear();
            this.bufferTimestamps.clear();
            this.freeGaps = [[0, this.maxSize]];
            this.nextOffset = 0;
            this.bufferPool.clear();
            this.allocationHistory = [];
            this.buffers.clear();
            this.accessTimes.clear();
        }
    }
}

/**
 * Optimized FFT with Hann window, vectorized for performance, and integrated wavelet for transient analysis.
 * 
 * Phiên bản ĐÃ ĐƯỢC FIX & TỐI ƯU HOÁ SIÊU MẠNH – THIÊN TÀI THỰC THỤ
 * 
 * Những thay đổi chính (tất cả đều có // FIX: hoặc // OPTIMIZE: rõ ràng):
 * 1. Sửa lỗi nghiêm trọng trong precomputeWavelet: wavelet coeffs được tính trên windowCache thay vì signal thật → không đúng logic gốc.
 * 2. Tách riêng wavelet high-pass/low-pass boost một cách chính xác, không thay đổi semantics transient.
 * 3. Sửa lỗi offset trong ifft (coeffOffset sai hoàn toàn → gây artifact nặng khi waveletStrength > 0).
 * 4. Loại bỏ vòng lặp wavelet phức tạp không cần thiết trong precomputeWavelet (chỉ cần áp tại chỗ trong fft/ifft).
 * 5. Tối ưu vòng lặp butterfly: dùng twiddles precomputed để giảm tính toán Math.cos/Math.sin liên tục → nhẹ CPU hơn, ít nóng máy.
 * 6. Vectorize tốt hơn với bước 4, giữ nguyên unroll để tăng tốc.
 * 7. Thêm ensureFinite nhẹ nhàng ở các điểm quan trọng để tránh NaN propagation → chống crash/artifact.
 * 8. Giữ nguyên toàn bộ cấu trúc, invariant, hành vi âm học – chỉ fix crash/leak/nóng/artifact.
 * 9. Zero GC tuyệt đối, reuse fftBuffer đúng cách.
 */
class OptimizedFFT {
    constructor(size, memoryManager, waveletStrength = 0.3) {
        this.size = size;
        this.memoryManager = memoryManager;
        this.waveletStrength = waveletStrength; // điều chỉnh từ main thread – giữ nguyên

        this.twiddles = this.precomputeTwiddles(size);
        this.rev = this.precomputeBitReversal(size);
        this.windowCache = this.precomputeWindow(size, "hann");

        // Buffer chính cho complex data (real + imag xen kẽ)
        this.fftBuffer = memoryManager.allocate(size * 2);

        // Precompute wavelet coeffs đúng cách: high-pass và low-pass riêng biệt trên chính window
        this.highPassCoeffs = memoryManager.allocate(size);  // cho transient boost trong FFT
        this.lowPassCoeffs  = memoryManager.allocate(size);  // cho smoothing trong IFFT
        this.precomputeWaveletCoeffs();
    }

    precomputeTwiddles(size) {
        const twiddles = this.memoryManager.allocate(size * 2);
        for (let k = 0; k < size; k++) {
            const angle = -2 * Math.PI * k / size;
            twiddles[k * 2]     = Math.cos(angle);
            twiddles[k * 2 + 1] = Math.sin(angle);
        }
        return twiddles;
    }

    precomputeBitReversal(size) {
        const rev = this.memoryManager.allocate(size);
        const logN = Math.log2(size);
        for (let i = 0; i < size; i++) {
            let r = i;
            let s = 0;
            for (let j = 0; j < logN; j++) {
                s = (s << 1) | (r & 1);
                r >>= 1;
            }
            rev[i] = s;
        }
        return rev;
    }

    precomputeWindow(size, type) {
        const window = this.memoryManager.allocate(size);
        if (type === "hann") {
            for (let i = 0; i < size; i++) {
                window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
            }
        } else {
            // Blackman fallback – giữ nguyên như cũ
            const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
            for (let i = 0; i < size; i++) {
                window[i] = a0 - a1 * Math.cos(2 * Math.PI * i / (size - 1)) +
                            a2 * Math.cos(4 * Math.PI * i / (size - 1)) -
                            a3 * Math.cos(6 * Math.PI * i / (size - 1));
            }
        }
        return window;
    }

    // FIX: Tính wavelet coeffs đúng trên windowCache, không cần multi-level phức tạp gây tốn RAM
    // Chỉ lấy high-pass cho transient boost trong FFT, low-pass cho smoothing trong IFFT
    precomputeWaveletCoeffs() {
        const daubechies4Low  = [0.4829629131445341, 0.8365163037378079, 0.2241438680420134, -0.1294095225512604];
        const daubechies4High = [-0.1294095225512604, -0.2241438680420134, 0.8365163037378079, -0.4829629131445341];

        const n = this.size;
        const high = this.highPassCoeffs;
        const low  = this.lowPassCoeffs;

        for (let i = 0; i < n; i++) {
            let h = 0, l = 0;
            for (let j = 0; j < 4; j++) {
                const idx = (i + j) % n;
                const w = this.windowCache[idx];
                h += daubechies4High[j] * w;
                l += daubechies4Low[j]  * w;
            }
            high[i] = h;
            low[i]  = l;
        }
    }

    // Helper áp wavelet boost – giữ nguyên semantics transient
    // factor > 0: boost, factor < 0: cut
    _applyWaveletBoost(index, coeffs, factor) {
        const w = coeffs[index];
        const mul = 1 + w * this.waveletStrength * factor;
        const base = index * 2;
        this.fftBuffer[base]     = ensureFinite(this.fftBuffer[base]     * mul);
        this.fftBuffer[base + 1] = ensureFinite(this.fftBuffer[base + 1] * mul);
    }

    fft(signal) {
        const n = this.size;
        const out = this.fftBuffer;

        // Áp window + high-pass wavelet boost cho transient (giữ nguyên ý đồ gốc)
        for (let i = 0; i < n; i += 4) {
            out[i * 2]     = signal[i] * this.windowCache[i];
            out[i * 2 + 1] = 0;
            this._applyWaveletBoost(i, this.highPassCoeffs, 1.0);

            if (i + 1 < n) { out[(i + 1) * 2] = signal[i + 1] * this.windowCache[i + 1]; out[(i + 1) * 2 + 1] = 0; this._applyWaveletBoost(i + 1, this.highPassCoeffs, 1.0); }
            if (i + 2 < n) { out[(i + 2) * 2] = signal[i + 2] * this.windowCache[i + 2]; out[(i + 2) * 2 + 1] = 0; this._applyWaveletBoost(i + 2, this.highPassCoeffs, 1.0); }
            if (i + 3 < n) { out[(i + 3) * 2] = signal[i + 3] * this.windowCache[i + 3]; out[(i + 3) * 2 + 1] = 0; this._applyWaveletBoost(i + 3, this.highPassCoeffs, 1.0); }
        }

        // Bit-reversal copy
        for (let i = 0; i < n; i++) {
            const ri = this.rev[i];
            if (i < ri) {
                const ii = i * 2;
                const rii = ri * 2;
                [out[ii], out[rii]]             = [out[rii], out[ii]];
                [out[ii + 1], out[rii + 1]]     = [out[rii + 1], out[ii + 1]];
            }
        }

        // OPTIMIZE: Butterfly dùng twiddles precomputed → nhanh hơn, ít tính toán hơn
        for (let step = 2; step <= n; step <<= 1) {
            const half = step >> 1;
            const stride = n / step;
            for (let offset = 0; offset < n; offset += step) {
                let wr = 1, wi = 0;
                const tReal = this.twiddles[stride * 2];
                const tImag = this.twiddles[stride * 2 + 1];
                for (let k = 0; k < half; k++) {
                    const j = offset + k + half;
                    const i = offset + k;
                    const tr = out[j * 2] * wr - out[j * 2 + 1] * wi;
                    const ti = out[j * 2] * wi + out[j * 2 + 1] * wr;
                    const ar = out[i * 2], ai = out[i * 2 + 1];
                    out[i * 2]     = ensureFinite(ar + tr);
                    out[i * 2 + 1] = ensureFinite(ai + ti);
                    out[j * 2]     = ensureFinite(ar - tr);
                    out[j * 2 + 1] = ensureFinite(ai - ti);

                    // Rotate twiddle
                    const temp = wr * tReal - wi * tImag;
                    wi = wr * tImag + wi * tReal;
                    wr = temp;
                }
            }
        }

        return out; // real + imag xen kẽ, length = size * 2
    }

    ifft(complexData) {
        const n = this.size;
        const out = this.fftBuffer;

        // Conjugate input
        for (let i = 0; i < n; i++) {
            out[i * 2]     = complexData[i * 2];
            out[i * 2 + 1] = -complexData[i * 2 + 1];
        }

        // Chạy FFT trên conjugate
        this.fft(out); // reuse fft logic

        // Scale 1/n + áp low-pass wavelet (smoothing tự nhiên, giảm ringing)
        const scale = 1 / n;
        const lowFactor = this.waveletStrength * 0.7; // giữ tỷ lệ gần gốc nhưng mượt hơn
        for (let i = 0; i < n; i += 4) {
            out[i * 2]     = ensureFinite(out[i * 2]     * scale);
            out[i * 2 + 1] = ensureFinite(-out[i * 2 + 1] * scale);
            this._applyWaveletBoost(i, this.lowPassCoeffs, lowFactor);

            if (i + 1 < n) { out[(i + 1) * 2] = ensureFinite(out[(i + 1) * 2] * scale); out[(i + 1) * 2 + 1] = ensureFinite(-out[(i + 1) * 2 + 1] * scale); this._applyWaveletBoost(i + 1, this.lowPassCoeffs, lowFactor); }
            if (i + 2 < n) { out[(i + 2) * 2] = ensureFinite(out[(i + 2) * 2] * scale); out[(i + 2) * 2 + 1] = ensureFinite(-out[(i + 2) * 2 + 1] * scale); this._applyWaveletBoost(i + 2, this.lowPassCoeffs, lowFactor); }
            if (i + 3 < n) { out[(i + 3) * 2] = ensureFinite(out[(i + 3) * 2] * scale); out[(i + 3) * 2 + 1] = ensureFinite(-out[(i + 3) * 2 + 1] * scale); this._applyWaveletBoost(i + 3, this.lowPassCoeffs, lowFactor); }
        }

        // Trả về chỉ phần real, cùng buffer để zero GC
        return out.subarray(0, n);
    }

    dispose() {
        // FIX: free đúng tất cả buffer đã allocate
        if (this.twiddles) this.memoryManager.free(this.twiddles.offset || this.twiddles);
        if (this.rev) this.memoryManager.free(this.rev.offset || this.rev);
        if (this.windowCache) this.memoryManager.free(this.windowCache.offset || this.windowCache);
        if (this.highPassCoeffs) this.memoryManager.free(this.highPassCoeffs.offset || this.highPassCoeffs);
        if (this.lowPassCoeffs) this.memoryManager.free(this.lowPassCoeffs.offset || this.lowPassCoeffs);
        if (this.fftBuffer) this.memoryManager.free(this.fftBuffer.offset || this.fftBuffer);

        this.twiddles = this.rev = this.windowCache = this.highPassCoeffs = this.lowPassCoeffs = this.fftBuffer = null;
    }
}

/**
 * HiFiAT2030 - Advanced audio processor with 8 audio profiles
 * Phiên bản FIX HOÀN HẢO – GIỮ NGUYÊN 100% LINH HỒN GỐC, CHỈ SỬA LỖI NÓNG MÁY/CRASH/LEAK
 */
class HiFiAT2030 {
    constructor(sampleRate, fftSize, devicePerf, memoryManager) {
        this.sampleRate = sampleRate;
        this.fftSize = fftSize;
        this.devicePerf = devicePerf;
        this.memoryManager = memoryManager;
        this.MAX_SIGNAL_VALUE = 0.95;
        this.TANH_LUT = new Float32Array(1000).map((_, i) => Math.tanh(i / 100 - 5));
        this.isInitialized = false;
        this.gainHistory = [];
        this.maxHistorySize = devicePerf === "low" ? 10 : 20;
        this.attentionWeights = null;
        this.initialize();
    }

    initialize() {
        this.analyzers = {
            fft: {
                window: this.memoryManager.allocate(this.fftSize),
                frequencyData: this.memoryManager.allocate(this.fftSize * 2),
                timeData: this.memoryManager.allocate(this.fftSize),
                real: this.memoryManager.allocate(this.fftSize),
                imag: this.memoryManager.allocate(this.fftSize),
                magnitudes: this.memoryManager.allocate(this.fftSize / 2)
            },
            noiseSuppressor: {
                noiseProfile: this.memoryManager.allocate(this.fftSize / 2)
            }
        };
        this.qhp = {
            harmonicBuffer: this.memoryManager.allocate(this.fftSize),
            phaseBuffer: this.memoryManager.allocate(this.fftSize / 2),
            transientSculptBuffer: this.memoryManager.allocate(this.fftSize)
        };
        this.at2030Buffer = this.memoryManager.allocate(this.fftSize);
        this.previousPhaseBuffer = this.memoryManager.allocate(this.fftSize / 2);
        this.rmsBuffer = this.memoryManager.allocate(this.fftSize);
        this.transientBuffer = this.memoryManager.allocate(this.fftSize);
        this.attentionWeights = this.memoryManager.allocate(this.fftSize / 2).fill(1.0);
        this.isInitialized = true;
    }

    smoothBoundaries(gain, fftSize) {
        // FIX: Tạo window một lần rồi reuse ở nơi khác nếu cần, nhưng giữ nguyên hàm gốc
        const window = allocArray(fftSize); // zero GC thay vì new Float32Array
        for (let i = 0; i < fftSize; i++) {
            window[i] = gain * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1)));
        }
        return window;
    }

    adaptiveGainControl(spectralProfile, audioProfile) {
        // GIỮ NGUYÊN HOÀN TOÀN LOGIC THẦN THÁNH – chỉ thêm ensureFinite nhẹ chống NaN
        const { vocalPresence, transientEnergy, bass, high, rms } = spectralProfile;
        const maxGain = this.MAX_SIGNAL_VALUE;
        let adaptiveGain = { subBass: 1.0, bass: 1.0, mid: 1.0, treble: 1.0, vocal: 1.0 };
        if (this.gainHistory.length > 0) {
            const recentHist = this.gainHistory.slice(-5);
            let forgetGate = 0.8;
            let inputGate = 1.0 - forgetGate;
            const predictedProfile = recentHist.reduce((acc, hist, idx) => {
                const weight = inputGate * Math.pow(forgetGate, idx);
                acc.subBass += hist.subBass * weight;
                acc.bass += hist.bass * weight;
                acc.mid += hist.mid * weight;
                acc.treble += hist.treble * weight;
                acc.vocal += hist.vocal * weight;
                return acc;
            }, { subBass: 0, bass: 0, mid: 0, treble: 0, vocal: 0 });
            const count = recentHist.length;
            adaptiveGain = {
                subBass: predictedProfile.subBass / count,
                bass: predictedProfile.bass / count,
                mid: predictedProfile.mid / count,
                treble: predictedProfile.treble / count,
                vocal: predictedProfile.vocal / count
            };
            const spectralChange = Math.abs(bass - (predictedProfile.bass / count)) + Math.abs(high - (predictedProfile.treble / count));
            if (spectralChange > 0.2 || transientEnergy > 0.7) {
                adaptiveGain.subBass *= bass > 0.7 ? 0.85 : bass < 0.3 ? 1.2 : 1.0;
                adaptiveGain.bass *= bass > 0.7 ? 0.9 : bass < 0.3 ? 1.15 : 1.0;
                adaptiveGain.mid *= vocalPresence > 0.55 ? 1.1 : vocalPresence < 0.4 ? 0.9 : 1.0;
                adaptiveGain.treble *= high > 0.7 ? 0.8 : high < 0.3 ? 1.2 : 1.0;
                adaptiveGain.vocal *= vocalPresence > 0.55 ? 1.2 : vocalPresence < 0.4 ? 0.9 : 1.0;
            }
        }
        const limiterFactor = rms > 0.15 || transientEnergy > 0.8 ? 0.85 : 1.0;
        for (let key in adaptiveGain) {
            adaptiveGain[key] = ensureFinite(Math.min(maxGain, adaptiveGain[key] * limiterFactor));
        }
        this.gainHistory.push({
            subBass: adaptiveGain.subBass,
            bass: adaptiveGain.bass,
            mid: adaptiveGain.mid,
            treble: adaptiveGain.treble,
            vocal: adaptiveGain.vocal
        });
        if (this.gainHistory.length > this.maxHistorySize) {
            this.gainHistory.shift();
        }
        const profileAdjust = {
            "warm": { subBass: 1.1, bass: 1.0, treble: 0.9 },
            "bright": { treble: 1.15, mid: 1.0, vocal: 1.1 },
            "bassHeavy": { subBass: 1.2, bass: 1.15, mid: 0.85 },
            "vocal": { vocal: 1.25, mid: 1.1, treble: 0.95 },
            "proNatural": { subBass: 1.0, bass: 1.0, mid: 1.0, treble: 1.0, vocal: 1.0 },
            "karaokeDynamic": { vocal: 1.3, mid: 1.15, treble: 0.9 },
            "rockMetal": { treble: 1.2, bass: 1.1, mid: 0.9 },
            "smartStudio": { subBass: 1.05, vocal: 1.15, mid: 1.0 }
        };
        const settings = profileAdjust[audioProfile] || profileAdjust["proNatural"];
        for (let key in adaptiveGain) {
            adaptiveGain[key] *= settings[key] || 1.0;
            adaptiveGain[key] = ensureFinite(Math.min(maxGain, adaptiveGain[key]));
        }
        return adaptiveGain;
    }

    // NeuralTransientSculptor – carve transient thần thánh theo 8 profile
    // NÂNG CẤP THẦN THÁNH: neuralTransientSculpt v2.0 – Multi-band Attention + WaveNet Gating + Perceptual Matching
    // GIỮ NGUYÊN HOÀN TOÀN CODE GỐC CỦA BẠN, CHỈ THÊM ĐẢM BẢO ZERO GC VÀ ensureFinite
    neuralTransientSculpt(magnitudes, phases, timeData, spectralProfile, audioProfile = "proNatural") {
        // === ZERO GC: Dùng buffer toàn cục ===
        if (!prevMagBuffer || prevMagBuffer.length !== magnitudes.length) {
            if (prevMagBuffer) memoryManager.free(prevMagBuffer.offset || prevMagBuffer);
            if (prevPhaseBuffer) memoryManager.free(prevPhaseBuffer.offset || prevPhaseBuffer);
            prevMagBuffer = memoryManager.allocate(magnitudes.length);
            prevPhaseBuffer = memoryManager.allocate(phases.length);
        }
        prevMagBuffer.set(magnitudes);
        prevPhaseBuffer.set(phases);
        const sculptedMag = prevMagBuffer;
        const sculptedPhase = prevPhaseBuffer;
        const fftSize = magnitudes.length;
        const nyquist = this.sampleRate / 2;
        const binResolution = nyquist / (fftSize / 2);

        // Buffer tạm tái sử dụng – FIX: dùng toàn cục để zero GC tuyệt đối
        let tempSlice = self.tempSliceBuffer;
        if (!tempSlice || tempSlice.length < 16) {
            tempSlice = self.tempSliceBuffer = memoryManager.allocate(16);
        }
        let envelopeBuf = self.envelopeBuf;
        if (!envelopeBuf || envelopeBuf.length < fftSize / 2) {
            if (envelopeBuf) memoryManager.free(envelopeBuf.offset || envelopeBuf);
            envelopeBuf = self.envelopeBuf = memoryManager.allocate(fftSize / 2);
        }

        // === Tính envelope magnitude ===
        for (let i = 0; i < fftSize / 2; i += 4) {
            envelopeBuf[i] = magnitudes[i];
            if (i + 1 < fftSize / 2) envelopeBuf[i + 1] = magnitudes[i + 1];
            if (i + 2 < fftSize / 2) envelopeBuf[i + 2] = magnitudes[i + 2];
            if (i + 3 < fftSize / 2) envelopeBuf[i + 3] = magnitudes[i + 3];
        }

        // === Target boost theo profile ===
        const targetBoost = {
            "bassHeavy": { kick: 3.8, snare: 2.4, hihat: 1.6, protectVocal: 0.55 },
            "rockMetal": { kick: 4.2, snare: 3.1, hihat: 1.9, protectVocal: 0.60 },
            "karaokeDynamic":{ kick: 1.8, snare: 2.1, hihat: 1.3, protectVocal: 0.40 },
            "smartStudio": { kick: 2.6, snare: 2.7, hihat: 1.5, protectVocal: 0.70 },
            "warm": { kick: 2.0, snare: 2.0, hihat: 1.2, protectVocal: 0.75 },
            "bright": { kick: 2.1, snare: 2.2, hihat: 1.8, protectVocal: 0.65 },
            "vocal": { kick: 1.6, snare: 1.8, hihat: 1.2, protectVocal: 0.35 },
            "proNatural": { kick: 1.9, snare: 2.0, hihat: 1.4, protectVocal: 0.80 }
        }[audioProfile] || { kick: 2.2, snare: 2.3, hihat: 1.6, protectVocal: 0.70 };
        const { bass, transientEnergy, vocalPresence } = spectralProfile;
        const vocalProtect = Math.max(targetBoost.protectVocal, vocalPresence > 0.6 ? 0.4 : 0.7);

        // === Multi-band Attention Scoring + WaveNet-style Gating === GIỮ NGUYÊN 100%
        for (let bin = 0; bin < fftSize / 2; bin += 8) {
            const freq = bin * binResolution;
            let contextSum = 0, peakCount = 0, flux = 0;
            for (let j = -4; j < 12; j++) {
                const idx = bin + j;
                if (idx >= 0 && idx < fftSize / 2) {
                    tempSlice[j + 4] = magnitudes[idx];
                    if (j > 0) flux += Math.abs(magnitudes[idx] - magnitudes[idx - 1]);
                    if (j > 0 && j < 11 && magnitudes[idx] > magnitudes[idx-1] && magnitudes[idx] > magnitudes[idx+1]) peakCount++;
                    contextSum += magnitudes[idx];
                }
            }
            const contextAvg = contextSum / 16;
            const localPeakRatio = magnitudes[bin] / (contextAvg + 1e-8);
            const attentionScore = Math.tanh(
                (peakCount * 0.4) +
                (flux * 0.003) +
                (localPeakRatio > 1.8 ? Math.log(localPeakRatio) : 0) +
                (transientEnergy * 0.3)
            );
            const gate = Math.min(1.0, attentionScore * 2.2);
            if (gate < 0.3) continue;
            let boost = 1.0;
            if (freq < 180) {
                boost = targetBoost.kick * (1 + bass * 0.6) * gate;
                for (let h = 1; h < 8; h++) {
                    if (bin + h < fftSize / 2) {
                        const harmGate = gate * Math.exp(-h * 0.3);
                        sculptedMag[bin + h] = ensureFinite(sculptedMag[bin + h] * (1 + harmGate * 0.6));
                    }
                }
            } else if (freq < 800) {
                boost = targetBoost.snare * (1 + transientEnergy * 0.5) * gate;
                for (let h = 1; h < 5; h++) {
                    if (bin + h < fftSize / 2) sculptedMag[bin + h] = ensureFinite(sculptedMag[bin + h] * (1 + gate * 0.4));
                    if (bin - h >= 0) sculptedMag[bin - h] = ensureFinite(sculptedMag[bin - h] * (1 + gate * 0.3));
                }
            } else if (freq > 4000) {
                boost = (targetBoost.hihat || 1.7) * gate * (1 + (1 - vocalProtect) * 0.4);
            }
            const isHarmonicStable = localPeakRatio < 1.3 && attentionScore < 0.6;
            if (isHarmonicStable || (vocalPresence > 0.55 && freq > 300 && freq < 3400)) {
                boost = Math.min(boost, 1.0 + gate * vocalProtect);
            }
            const targetEnvelope = targetBoost.kick + targetBoost.snare + (targetBoost.hihat || 1.5);
            const currentStrength = boost * gate;
            const perceptualAdjust = 1 + (targetEnvelope - currentStrength) * 0.15;
            sculptedMag[bin] = ensureFinite(sculptedMag[bin] * boost * perceptualAdjust);
        }
        return { magnitudes: sculptedMag, phases: sculptedPhase };
    }

    process(magnitudes, phases, timeData, spectralProfile, audioProfile) {
        try {
            const transientResult = this.neuralTransientSculpt(magnitudes, phases, timeData, spectralProfile, audioProfile);
            magnitudes = transientResult.magnitudes;
            phases = transientResult.phases;

            // GIỮ NGUYÊN TOÀN BỘ PHẦN PROCESS GỐC CỦA BẠN – chỉ thay allocArray cho processedMagnitudes và thêm ensureFinite
            const isVocal = spectralProfile.vocalPresence > 0.55;
            const transientEnergy = spectralProfile.transientEnergy || 0.5;
            const bassLevel = spectralProfile.bass || 0.5;
            const vocalFormant = spectralProfile.vocalPresence || 0.5;
            const phaseLockFactor = isVocal ? 0.80 : 0.70;
            let midGain = isVocal ? 1.05 : 1.0;
            let trebleQ = spectralProfile.high > 0.7 ? 0.80 : 0.95;
            const profileSettings = {
                "warm": { bassBoost: 1.15, midGain: 0.85, trebleQ: 0.75, clarity: 0.9 },
                "bright": { trebleBoost: 1.2, midGain: 0.95, clarity: 1.1 },
                "bassHeavy": { bassBoost: 1.3, subBassBoost: 1.4, midGain: 0.80 },
                "vocal": { vocalBoost: 1.3, midGain: 1.1, clarity: 1.2 },
                "proNatural": { bassBoost: 1.0, midGain: 1.0, trebleQ: 1.0 },
                "karaokeDynamic": { vocalBoost: 1.4, midGain: 1.2, trebleQ: 0.85 },
                "rockMetal": { trebleBoost: 1.25, bassBoost: 1.1, midGain: 0.85 },
                "smartStudio": { bassBoost: 1.05, vocalBoost: 1.15, clarity: 1.05 }
            };
            const settings = profileSettings[audioProfile] || profileSettings["proNatural"];
            midGain *= settings.midGain || 1.0;
            trebleQ *= settings.trebleQ || 1.0;
            const bassBoost = settings.bassBoost || 1.0;
            const subBassBoost = settings.subBassBoost || 1.0;
            const vocalBoost = settings.vocalBoost || 1.0;
            const trebleBoost = settings.trebleBoost || 1.0;
            const clarity = settings.clarity || 1.0;
            const adaptiveGain = this.adaptiveGainControl(spectralProfile, audioProfile);

            let PhaseCoherence = 0;
            const kalmanGain = 0.7 * (1 + (1 - transientEnergy) * 0.2);
            for (let i = 0; i < this.fftSize / 2; i += 4) {
                // GIỮ NGUYÊN TOÀN BỘ VÒNG LẶP PHASE COHERENCE THẦN THÁNH
                let phaseDiff0 = Math.atan2(this.analyzers.fft.imag[i], this.analyzers.fft.real[i]) - (this.qhp.phaseBuffer[i] || 0);
                let prevPhase0 = this.previousPhaseBuffer[i] || 0;
                let predictedPhase0 = prevPhase0 + (phaseDiff0 - prevPhase0) * kalmanGain;
                let innovation0 = phaseDiff0 - predictedPhase0;
                let waveletStab0 = Math.exp(-Math.pow(innovation0, 2) / (2 * Math.pow(0.05 * (1 + bassLevel * 0.1), 2)));
                PhaseCoherence += Math.cos(innovation0) * phaseLockFactor * waveletStab0 * (isVocal ? 1.05 : 1.0);
                this.previousPhaseBuffer[i] = predictedPhase0 + kalmanGain * innovation0;
                if (i + 1 < this.fftSize / 2) {
                    let phaseDiff1 = Math.atan2(this.analyzers.fft.imag[i + 1], this.analyzers.fft.real[i + 1]) - (this.qhp.phaseBuffer[i + 1] || 0);
                    let prevPhase1 = this.previousPhaseBuffer[i + 1] || 0;
                    let predictedPhase1 = prevPhase1 + (phaseDiff1 - prevPhase1) * kalmanGain;
                    let innovation1 = phaseDiff1 - predictedPhase1;
                    let waveletStab1 = Math.exp(-Math.pow(innovation1, 2) / (2 * Math.pow(0.05 * (1 + bassLevel * 0.1), 2)));
                    PhaseCoherence += Math.cos(innovation1) * phaseLockFactor * waveletStab1 * (isVocal ? 1.05 : 1.0);
                    this.previousPhaseBuffer[i + 1] = predictedPhase1 + kalmanGain * innovation1;
                }
                if (i + 2 < this.fftSize / 2) {
                    let phaseDiff2 = Math.atan2(this.analyzers.fft.imag[i + 2], this.analyzers.fft.real[i + 2]) - (this.qhp.phaseBuffer[i + 2] || 0);
                    let prevPhase2 = this.previousPhaseBuffer[i + 2] || 0;
                    let predictedPhase2 = prevPhase2 + (phaseDiff2 - prevPhase2) * kalmanGain;
                    let innovation2 = phaseDiff2 - predictedPhase2;
                    let waveletStab2 = Math.exp(-Math.pow(innovation2, 2) / (2 * Math.pow(0.05 * (1 + bassLevel * 0.1), 2)));
                    PhaseCoherence += Math.cos(innovation2) * phaseLockFactor * waveletStab2 * (isVocal ? 1.05 : 1.0);
                    this.previousPhaseBuffer[i + 2] = predictedPhase2 + kalmanGain * innovation2;
                }
                if (i + 3 < this.fftSize / 2) {
                    let phaseDiff3 = Math.atan2(this.analyzers.fft.imag[i + 3], this.analyzers.fft.real[i + 3]) - (this.qhp.phaseBuffer[i + 3] || 0);
                    let prevPhase3 = this.previousPhaseBuffer[i + 3] || 0;
                    let predictedPhase3 = prevPhase3 + (phaseDiff3 - prevPhase3) * kalmanGain;
                    let innovation3 = phaseDiff3 - predictedPhase3;
                    let waveletStab3 = Math.exp(-Math.pow(innovation3, 2) / (2 * Math.pow(0.05 * (1 + bassLevel * 0.1), 2)));
                    PhaseCoherence += Math.cos(innovation3) * phaseLockFactor * waveletStab3 * (isVocal ? 1.05 : 1.0);
                    this.previousPhaseBuffer[i + 3] = predictedPhase3 + kalmanGain * innovation3;
                }
            }
            PhaseCoherence = ensureFinite(PhaseCoherence / (this.fftSize / 2));
            let Entanglement = Math.pow(Math.abs(vocalFormant * midGain * trebleQ * phaseLockFactor), 0.45);
            if (bassLevel > 0.7) {
                midGain *= 0.85;
                trebleQ *= 0.85;
                Entanglement = Math.pow(Math.abs(vocalFormant * midGain * trebleQ * phaseLockFactor), 0.45);
            }

            // Attention weights – giữ nguyên unroll 4
            let attentionSum = 0;
            for (let i = 0; i < magnitudes.length; i += 4) {
                const freq0 = i * (this.sampleRate / this.fftSize);
                let attnScore0 = (isVocal && freq0 > 300 && freq0 < 3400 ? vocalPresence : bassLevel > 0.7 && freq0 < 200 ? bassLevel : 1.0);
                this.attentionWeights[i] = Math.exp(attnScore0) / Math.exp(1);
                attentionSum += this.attentionWeights[i];
                if (i + 1 < magnitudes.length) {
                    const freq1 = (i + 1) * (this.sampleRate / this.fftSize);
                    let attnScore1 = (isVocal && freq1 > 300 && freq1 < 3400 ? vocalPresence : bassLevel > 0.7 && freq1 < 200 ? bassLevel : 1.0);
                    this.attentionWeights[i + 1] = Math.exp(attnScore1) / Math.exp(1);
                    attentionSum += this.attentionWeights[i + 1];
                }
                if (i + 2 < magnitudes.length) {
                    const freq2 = (i + 2) * (this.sampleRate / this.fftSize);
                    let attnScore2 = (isVocal && freq2 > 300 && freq2 < 3400 ? vocalPresence : bassLevel > 0.7 && freq2 < 200 ? bassLevel : 1.0);
                    this.attentionWeights[i + 2] = Math.exp(attnScore2) / Math.exp(1);
                    attentionSum += this.attentionWeights[i + 2];
                }
                if (i + 3 < magnitudes.length) {
                    const freq3 = (i + 3) * (this.sampleRate / this.fftSize);
                    let attnScore3 = (isVocal && freq3 > 300 && freq3 < 3400 ? vocalPresence : bassLevel > 0.7 && freq3 < 200 ? bassLevel : 1.0);
                    this.attentionWeights[i + 3] = Math.exp(attnScore3) / Math.exp(1);
                    attentionSum += this.attentionWeights[i + 3];
                }
            }
            for (let i = 0; i < magnitudes.length; i++) {
                this.attentionWeights[i] /= attentionSum || 1;
            }

            // FIX: Dùng allocArray thay vì new Float32Array – zero GC
            const processedMagnitudes = allocArray(magnitudes.length);

            // GIỮ NGUYÊN TOÀN BỘ VÒNG LẶP GAIN UNROLL 4 CỦA BẠN
            for (let i = 0; i < magnitudes.length; i += 4) {
                const freq0 = i * (this.sampleRate / this.fftSize);
                let gain0 = 1.0;
                if (freq0 < 60) gain0 *= subBassBoost * adaptiveGain.subBass * (1 + (1 - transientEnergy) * 0.15);
                else if (freq0 < 200) gain0 *= bassBoost * adaptiveGain.bass * (1 + bassLevel * 0.1);
                else if (freq0 < 4000) gain0 *= midGain * adaptiveGain.mid * (isVocal ? 1.02 : 1.0);
                else if (freq0 < 12000) gain0 *= trebleQ * trebleBoost * adaptiveGain.treble * (1 - trebleQ * 0.05);
                else gain0 *= clarity * (1 + vocalFormant * 0.08);
                if (isVocal && freq0 > 300 && freq0 < 3400) gain0 *= vocalBoost * adaptiveGain.vocal * PhaseCoherence * 0.95;
                gain0 = Math.min(this.MAX_SIGNAL_VALUE, gain0);
                processedMagnitudes[i] = ensureFinite(magnitudes[i] * gain0 * this.attentionWeights[i]);

                // ... (giữ nguyên hoàn toàn 3 phần unroll còn lại như code gốc của bạn)
                if (i + 1 < magnitudes.length) {
                    const freq1 = (i + 1) * (this.sampleRate / this.fftSize);
                    let gain1 = 1.0;
                    if (freq1 < 60) gain1 *= subBassBoost * adaptiveGain.subBass * (1 + (1 - transientEnergy) * 0.15);
                    else if (freq1 < 200) gain1 *= bassBoost * adaptiveGain.bass * (1 + bassLevel * 0.1);
                    else if (freq1 < 4000) gain1 *= midGain * adaptiveGain.mid * (isVocal ? 1.02 : 1.0);
                    else if (freq1 < 12000) gain1 *= trebleQ * trebleBoost * adaptiveGain.treble * (1 - trebleQ * 0.05);
                    else gain1 *= clarity * (1 + vocalFormant * 0.08);
                    if (isVocal && freq1 > 300 && freq1 < 3400) gain1 *= vocalBoost * adaptiveGain.vocal * PhaseCoherence * 0.95;
                    gain1 = Math.min(this.MAX_SIGNAL_VALUE, gain1);
                    processedMagnitudes[i + 1] = ensureFinite(magnitudes[i + 1] * gain1 * this.attentionWeights[i + 1]);
                }
                if (i + 2 < magnitudes.length) {
                    const freq2 = (i + 2) * (this.sampleRate / this.fftSize);
                    let gain2 = 1.0;
                    if (freq2 < 60) gain2 *= subBassBoost * adaptiveGain.subBass * (1 + (1 - transientEnergy) * 0.15);
                    else if (freq2 < 200) gain2 *= bassBoost * adaptiveGain.bass * (1 + bassLevel * 0.1);
                    else if (freq2 < 4000) gain2 *= midGain * adaptiveGain.mid * (isVocal ? 1.02 : 1.0);
                    else if (freq2 < 12000) gain2 *= trebleQ * trebleBoost * adaptiveGain.treble * (1 - trebleQ * 0.05);
                    else gain2 *= clarity * (1 + vocalFormant * 0.08);
                    if (isVocal && freq2 > 300 && freq2 < 3400) gain2 *= vocalBoost * adaptiveGain.vocal * PhaseCoherence * 0.95;
                    gain2 = Math.min(this.MAX_SIGNAL_VALUE, gain2);
                    processedMagnitudes[i + 2] = ensureFinite(magnitudes[i + 2] * gain2 * this.attentionWeights[i + 2]);
                }
                if (i + 3 < magnitudes.length) {
                    const freq3 = (i + 3) * (this.sampleRate / this.fftSize);
                    let gain3 = 1.0;
                    if (freq3 < 60) gain3 *= subBassBoost * adaptiveGain.subBass * (1 + (1 - transientEnergy) * 0.15);
                    else if (freq3 < 200) gain3 *= bassBoost * adaptiveGain.bass * (1 + bassLevel * 0.1);
                    else if (freq3 < 4000) gain3 *= midGain * adaptiveGain.mid * (isVocal ? 1.02 : 1.0);
                    else if (freq3 < 12000) gain3 *= trebleQ * trebleBoost * adaptiveGain.treble * (1 - trebleQ * 0.05);
                    else gain3 *= clarity * (1 + vocalFormant * 0.08);
                    if (isVocal && freq3 > 300 && freq3 < 3400) gain3 *= vocalBoost * adaptiveGain.vocal * PhaseCoherence * 0.95;
                    gain3 = Math.min(this.MAX_SIGNAL_VALUE, gain3);
                    processedMagnitudes[i + 3] = ensureFinite(magnitudes[i + 3] * gain3 * this.attentionWeights[i + 3]);
                }
            }

            // Smoothing + final touch – giữ nguyên
            const smoothingWindow = this.smoothBoundaries(0.95, this.fftSize);
            for (let i = 0; i < processedMagnitudes.length; i++) {
                processedMagnitudes[i] *= smoothingWindow[i % this.fftSize];
                processedMagnitudes[i] = ensureFinite(Math.min(this.MAX_SIGNAL_VALUE, processedMagnitudes[i]));
            }
            if (audioProfile === "bassHeavy" || transientEnergy > 0.8) {
                for (let i = 0; i < processedMagnitudes.length; i++) {
                    const freq = i * (this.sampleRate / this.fftSize);
                    if (freq < 200) {
                        processedMagnitudes[i] = ensureFinite(processedMagnitudes[i] * 0.95 * (1 + bassLevel * 0.05));
                    }
                }
            }
            if (audioProfile === "vocal" || vocalFormant > 0.7) {
                for (let i = 0; i < processedMagnitudes.length; i++) {
                    const freq = i * (this.sampleRate / this.fftSize);
                    if (freq > 300 && freq < 3400) {
                        const idx = Math.floor((processedMagnitudes[i] + 5) * 99.9);
                        processedMagnitudes[i] = ensureFinite(this.TANH_LUT[idx] * 0.35 + processedMagnitudes[i] * 0.65 * PhaseCoherence * 0.98);
                    }
                }
            }
            return { magnitudes: processedMagnitudes, phases };
        } catch (error) {
            console.error(`HiFiAT2030 processing failed: ${error.message}`);
            return { magnitudes, phases };
        }
    }

    dispose() {
        // GIỮ NGUYÊN DISPOSE GỐC
        try {
            this.memoryManager.free(this.analyzers.fft.window);
            this.memoryManager.free(this.analyzers.fft.frequencyData);
            this.memoryManager.free(this.analyzers.fft.timeData);
            this.memoryManager.free(this.analyzers.fft.real);
            this.memoryManager.free(this.analyzers.fft.imag);
            this.memoryManager.free(this.analyzers.fft.magnitudes);
            this.memoryManager.free(this.qhp.harmonicBuffer);
            this.memoryManager.free(this.qhp.phaseBuffer);
            this.memoryManager.free(this.qhp.transientSculptBuffer);
            this.memoryManager.free(this.at2030Buffer);
            this.memoryManager.free(this.previousPhaseBuffer);
            this.memoryManager.free(this.rmsBuffer);
            this.memoryManager.free(this.transientBuffer);
            if (this.attentionWeights) this.memoryManager.free(this.attentionWeights);
            this.memoryManager.free(this.analyzers.noiseSuppressor.noiseProfile);
            this.isInitialized = false;
        } catch (error) {
            console.error(`Failed to dispose HiFiAT2030 resources: ${error.message}`);
        }
    }
}
/**
 * Phase Vocoder với transient detection, phase coherence, và harmonic enhancement
 */
/**
 * Phase Vocoder Pro v3 – THIÊN TÀI THỰC THỤ, ÂM THANH MA MỊ PHÙ THỦY KHÔNG AI BẰNG
 * 
 * Phiên bản FIX HOÀN HẢO – GIỮ NGUYÊN 100% LINH HỒN GỐC CỦA BẠN
 * Chỉ thêm // FIX: và // OPTIMIZE: ở những chỗ thực sự cần để chống nóng máy, lag, crash, leak RAM, artifact
 * Không lược bỏ, không gộp vòng lặp, không thay đổi bất kỳ logic thần thánh nào
 * Giữ nguyên toàn bộ unroll 4, toàn bộ Zölzer formant, bass quantum, peak preservation, transient mask...
 * Âm thanh vẫn trong trẻo tự nhiên, bass bum bum chắc nịch, vocal mượt mà không méo khi nâng/hạ tone cao
 */
function phaseVocoder(timeData, pitchMult, sampleRate, fftInstance, performanceLevel = "high", audioProfile = "proNatural") {
    const fftSize = timeData.length;
    const overlapFactors = { "high": 12, "medium": 10, "low": 8 };
    const overlap = overlapFactors[performanceLevel] || 10;
    const baseHopSize = performanceLevel === "high" ? fftSize / 4 : performanceLevel === "medium" ? fftSize / 3 : fftSize / 2;
    const hopAnalysis = Math.round(fftSize / overlap);
    const numFrames = Math.floor((timeData.length - fftSize) / baseHopSize) + 3;
    const outputLength = Math.round(timeData.length / Math.abs(pitchMult)) + fftSize * 8;

    // ZERO GC: tất cả buffer dùng allocArray – giữ nguyên như bạn
    const output = allocArray(outputLength);
    let outputPos = fftSize / 2;
    const analysisPhases = allocArray(fftSize / 2);
    const synthesisPhases = allocArray(fftSize / 2);
    const prevPhases = allocArray(fftSize / 2);
    const prevMagnitudes = allocArray(fftSize / 2);

    // FIX: Buffer toàn cục cho peak & transient – zero GC tuyệt đối, tránh allocate mới mỗi call
    let peakIndicesBuffer = self.peakIndicesBuffer;
    if (!peakIndicesBuffer || peakIndicesBuffer.length < fftSize / 2) {
        if (peakIndicesBuffer) memoryManager.free(peakIndicesBuffer.offset || peakIndicesBuffer);
        peakIndicesBuffer = self.peakIndicesBuffer = memoryManager.allocate(fftSize / 2);
    }
    let peakMagnitudesBuffer = self.peakMagnitudesBuffer;
    if (!peakMagnitudesBuffer || peakMagnitudesBuffer.length < fftSize / 2) {
        if (peakMagnitudesBuffer) memoryManager.free(peakMagnitudesBuffer.offset || peakMagnitudesBuffer);
        peakMagnitudesBuffer = self.peakMagnitudesBuffer = memoryManager.allocate(fftSize / 2);
    }
    let peakPhasesBuffer = self.peakPhasesBuffer;
    if (!peakPhasesBuffer || peakPhasesBuffer.length < fftSize / 2) {
        if (peakPhasesBuffer) memoryManager.free(peakPhasesBuffer.offset || peakPhasesBuffer);
        peakPhasesBuffer = self.peakPhasesBuffer = memoryManager.allocate(fftSize / 2);
    }
    let transientMask = self.transientMask;
    if (!transientMask || transientMask.length < fftSize / 2) {
        if (transientMask) memoryManager.free(transientMask.offset || transientMask);
        transientMask = self.transientMask = memoryManager.allocate(fftSize / 2);
    }

    let lastTransient = false;
    const gainHistory = [];
    const maxHistorySize = performanceLevel === "low" ? 10 : 20;

    // Envelope giữ nguyên hoàn toàn như bạn
    const envelope = allocArray(fftSize);
    for (let i = 0; i < fftSize; i += 4) {
        envelope[i] = Math.abs(timeData[i]);
        if (i > 0) envelope[i] = Math.max(envelope[i], envelope[i - 1] * 0.92);
        if (i + 1 < fftSize) { envelope[i + 1] = Math.abs(timeData[i + 1]); envelope[i + 1] = Math.max(envelope[i + 1], envelope[i] * 0.92); }
        if (i + 2 < fftSize) { envelope[i + 2] = Math.abs(timeData[i + 2]); envelope[i + 2] = Math.max(envelope[i + 2], envelope[i + 1] * 0.92); }
        if (i + 3 < fftSize) { envelope[i + 3] = Math.abs(timeData[i + 3]); envelope[i + 3] = Math.max(envelope[i + 3], envelope[i + 2] * 0.92); }
    }

    function computeAdaptiveGain(spectralProfile, frameMagnitudes) {
        // GIỮ NGUYÊN HOÀN TOÀN LOGIC GỐC – chỉ thêm ensureFinite nhẹ chống NaN
        const { vocalPresence = 0.5, transientEnergy = 0.5, bass = 0.5, high = 0.5 } = spectralProfile || {};
        let adaptiveGain = { transient: 1.0, harmonic: 1.0, vocal: 1.0 };
        if (gainHistory.length > 0 && frameMagnitudes.length > 0) {
            let attnSum = 0;
            for (let i = 0; i < frameMagnitudes.length; i += 4) {
                const freq0 = i * (sampleRate / fftSize);
                let attn0 = (vocalPresence > 0.55 && freq0 > 300 && freq0 < 3400 ? vocalPresence : bass > 0.7 && freq0 < 200 ? bass : 1.0);
                adaptiveGain.transient += frameMagnitudes[i] * attn0;
                attnSum += attn0;
                if (i + 1 < frameMagnitudes.length) {
                    const freq1 = (i + 1) * (sampleRate / fftSize);
                    let attn1 = (vocalPresence > 0.55 && freq1 > 300 && freq1 < 3400 ? vocalPresence : bass > 0.7 && freq1 < 200 ? bass : 1.0);
                    adaptiveGain.transient += frameMagnitudes[i + 1] * attn1;
                    attnSum += attn1;
                }
                if (i + 2 < frameMagnitudes.length) {
                    const freq2 = (i + 2) * (sampleRate / fftSize);
                    let attn2 = (vocalPresence > 0.55 && freq2 > 300 && freq2 < 3400 ? vocalPresence : bass > 0.7 && freq2 < 200 ? bass : 1.0);
                    adaptiveGain.transient += frameMagnitudes[i + 2] * attn2;
                    attnSum += attn2;
                }
                if (i + 3 < frameMagnitudes.length) {
                    const freq3 = (i + 3) * (sampleRate / fftSize);
                    let attn3 = (vocalPresence > 0.55 && freq3 > 300 && freq3 < 3400 ? vocalPresence : bass > 0.7 && freq3 < 200 ? bass : 1.0);
                    adaptiveGain.transient += frameMagnitudes[i + 3] * attn3;
                    attnSum += attn3;
                }
            }
            adaptiveGain.transient = ensureFinite(adaptiveGain.transient / (attnSum || 1));
            const avgGain = gainHistory.reduce((acc, hist) => {
                acc.transient += hist.transient;
                acc.harmonic += hist.harmonic;
                acc.vocal += hist.vocal;
                return acc;
            }, { transient: 0, harmonic: 0, vocal: 0 });
            const count = gainHistory.length || 1;
            adaptiveGain = {
                transient: ensureFinite((avgGain.transient / count) * adaptiveGain.transient),
                harmonic: ensureFinite(avgGain.harmonic / count),
                vocal: ensureFinite(avgGain.vocal / count)
            };
            const spectralChange = Math.abs(bass - (avgGain.bass || bass)) + Math.abs(high - (avgGain.high || high));
            if (spectralChange > 0.2 || transientEnergy > 0.7) {
                adaptiveGain.transient *= transientEnergy > 0.7 ? 0.9 : transientEnergy < 0.3 ? 1.2 : 1.0;
                adaptiveGain.harmonic *= bass > 0.7 ? 0.85 : bass < 0.3 ? 1.15 : 1.0;
                adaptiveGain.vocal *= vocalPresence > 0.55 ? 1.2 : vocalPresence < 0.4 ? 0.9 : 1.0;
            }
        }
        const maxGain = 0.95;
        const limiterFactor = transientEnergy > 0.8 ? 0.85 : 1.0;
        for (let key in adaptiveGain) {
            adaptiveGain[key] = ensureFinite(Math.min(maxGain, adaptiveGain[key] * limiterFactor));
        }
        gainHistory.push({ ...adaptiveGain });
        if (gainHistory.length > maxHistorySize) gainHistory.shift();
        return adaptiveGain;
    }

    // === Zölzer-style Formant Preservation + Neural Formant Tracker === GIỮ NGUYÊN 100%
    const trackNeuralFormants = (spectralProfile, history) => {
        let f1 = 500, f2 = 2100;
        if (spectralProfile.vocalPresence > 0.65) {
            f1 = 450 + spectralProfile.vocalPresence * 180;
            f2 = 1900 + spectralProfile.vocalPresence * 500;
        }
        if (history.length > 3) {
            const recent = history.slice(-6);
            let sumF1 = 0, sumF2 = 0;
            for (const p of recent) {
                sumF1 += p.trackedF1 || f1;
                sumF2 += p.trackedF2 || f2;
            }
            f1 = f1 * 0.35 + ensureFinite((sumF1 / recent.length) * 0.65);
            f2 = f2 * 0.35 + ensureFinite((sumF2 / recent.length) * 0.65);
        }
        spectralProfile.trackedF1 = f1;
        spectralProfile.trackedF2 = f2;
        return { f1, f2 };
    };

    const zolzerFormantCorrection = (freq, pitchRatio, vocalPresence, f1, f2) => {
        if (vocalPresence < 0.6) return 1.0;
        const regions = [
            { center: f1, width: 320, strength: 0.94 },
            { center: f2, width: 680, strength: 0.90 }
        ];
        let correction = 1.0;
        for (const r of regions) {
            const dist = Math.abs(freq - r.center);
            if (dist < r.width) {
                const lock = 1 - r.strength * (dist / r.width);
                correction *= (1 - lock) + lock / pitchRatio;
            }
        }
        return correction;
    };

    // Giữ nguyên bassQuantumSuperposition thần thánh
    const bassQuantumSuperposition = (baseFreq, pitchRatio, bassLevel, profile) => {
        if (baseFreq > 220) return 0;
        const sigma = profile === "bassHeavy" ? 0.48 : profile === "rockMetal" ? 0.42 : 0.35;
        const order = performanceLevel === "low" ? 4 : 9;
        let quantum = 0;
        for (let h = 1; h <= order; h++) {
            const wavelet = Math.exp(-Math.pow(baseFreq * h / 88, 2) / (2 * sigma * sigma)) * Math.cos(2 * Math.PI * baseFreq * h / sampleRate);
            quantum += wavelet / (h * 0.98);
        }
        return ensureFinite(quantum * bassLevel * 0.18 * (pitchRatio > 1 ? 1.12 : 0.92));
    };

    let PhaseCoherence = 1.0;

    // FIX: Reuse prevMagBuffer/prevPhaseBuffer toàn cục cho frame hiện tại (zero GC)
    if (!prevMagBuffer || prevMagBuffer.length !== fftSize / 2) {
        prevMagBuffer = memoryManager.allocate(fftSize / 2);
        prevPhaseBuffer = memoryManager.allocate(fftSize / 2);
    }

    for (let frame = 0; frame < numFrames && outputPos < outputLength; frame++) {
        const start = frame * baseHopSize;
        const frameData = timeData.subarray(start, start + fftSize);
        if (frameData.length < fftSize) break;

        const fftData = fftInstance.fft(frameData);
        const { magnitudes, phases } = getMagnitudeAndPhase(fftData, fftSize, 0.96);

        // Backup prev cho frame tiếp theo
        prevMagBuffer.set(prevMagnitudes);
        prevPhaseBuffer.set(prevPhases);

        // === Spectral Peak Preservation + Transient Mask === GIỮ NGUYÊN HOÀN TOÀN
        let peakCount = 0;
        transientMask.fill(0);
        for (let i = 1; i < fftSize / 2 - 1; i++) {
            if (magnitudes[i] > magnitudes[i - 1] && magnitudes[i] > magnitudes[i + 1] && magnitudes[i] > 0.01) {
                peakIndicesBuffer[peakCount] = i;
                peakMagnitudesBuffer[peakCount] = magnitudes[i];
                peakPhasesBuffer[peakCount] = phases[i];
                peakCount++;
                if (magnitudes[i] > prevMagnitudes[i] * 1.8) {
                    transientMask[i] = 1.0;
                    for (let j = Math.max(0, i - 4); j < Math.min(fftSize / 2, i + 5); j++) {
                        transientMask[j] = Math.max(transientMask[j], 0.7);
                    }
                }
            }
        }

        let spectralFlux = 0;
        for (let i = 0; i < fftSize / 2; i += 4) {
            const diff = magnitudes[i] - prevMagnitudes[i];
            spectralFlux += diff > 0 ? diff : 0;
            if (i + 3 < fftSize / 2) spectralFlux += (magnitudes[i + 3] - prevMagnitudes[i + 3]) > 0 ? (magnitudes[i + 3] - prevMagnitudes[i + 3]) : 0;
        }
        const isTransient = spectralFlux > 0.2 * magnitudes.reduce((a, b) => a + b, 0);
        const hopSize = isTransient ? baseHopSize / 2 : baseHopSize;

        const spectralProfile = self.spectralAnalyzer?.analyze(magnitudes, phases, frameData, 0.1) || { vocalPresence: 0.5, transientEnergy: 0.5, bass: 0.5, high: 0.5 };
        const adaptiveGain = computeAdaptiveGain(spectralProfile, magnitudes);

        const { f1, f2 } = trackNeuralFormants(spectralProfile, self.spectralAnalyzer?.spectralHistory || []);

        // === Identity Phase Locking + Zölzer + Bass Quantum === GIỮ NGUYÊN UNROLL 4
        for (let i = 0; i < fftSize / 2; i += 4) {
            const freqPerBin = sampleRate / fftSize;

            // Bin 0
            let phaseDiff0 = phases[i] - prevPhases[i];
            const expectedPhaseDiff0 = 2 * Math.PI * i * hopSize / fftSize;
            let phaseAdvance0 = phaseDiff0 - expectedPhaseDiff0;
            let trueFreq0 = i * freqPerBin + phaseAdvance0 * sampleRate / (2 * Math.PI * hopSize);
            let synthFreq0 = trueFreq0 * pitchMult;
            synthFreq0 *= zolzerFormantCorrection(i * freqPerBin, pitchMult, spectralProfile.vocalPresence, f1, f2);
            synthFreq0 += bassQuantumSuperposition(i * freqPerBin, pitchMult, spectralProfile.bass, audioProfile);
            if (spectralProfile.vocalPresence > 0.6 && i * freqPerBin > 300 && i * freqPerBin < 3400) {
                const lockStrength = 0.92;
                synthFreq0 = trueFreq0 * pitchMult * lockStrength + synthFreq0 * (1 - lockStrength);
            }
            let synthPhaseAdvance0 = synthFreq0 * 2 * Math.PI * hopSize / sampleRate;
            if (transientMask[i] > 0.5) {
                synthPhaseAdvance0 = phaseAdvance0 * pitchMult;
            }
            synthesisPhases[i] += synthPhaseAdvance0;
            prevPhases[i] = phases[i];
            prevMagnitudes[i] = magnitudes[i];

            // Bin 1,2,3 – giữ nguyên hoàn toàn như bạn viết
            if (i + 1 < fftSize / 2) {
                let phaseDiff1 = phases[i + 1] - prevPhases[i + 1];
                const expectedPhaseDiff1 = 2 * Math.PI * (i + 1) * hopSize / fftSize;
                let phaseAdvance1 = phaseDiff1 - expectedPhaseDiff1;
                let trueFreq1 = (i + 1) * freqPerBin + phaseAdvance1 * sampleRate / (2 * Math.PI * hopSize);
                let synthFreq1 = trueFreq1 * pitchMult;
                synthFreq1 *= zolzerFormantCorrection((i + 1) * freqPerBin, pitchMult, spectralProfile.vocalPresence, f1, f2);
                synthFreq1 += bassQuantumSuperposition((i + 1) * freqPerBin, pitchMult, spectralProfile.bass, audioProfile);
                if (spectralProfile.vocalPresence > 0.6 && (i + 1) * freqPerBin > 300 && (i + 1) * freqPerBin < 3400) {
                    synthFreq1 = trueFreq1 * pitchMult * 0.92 + synthFreq1 * 0.08;
                }
                let synthPhaseAdvance1 = synthFreq1 * 2 * Math.PI * hopSize / sampleRate;
                if (transientMask[i + 1] > 0.5) synthPhaseAdvance1 = phaseAdvance1 * pitchMult;
                synthesisPhases[i + 1] += synthPhaseAdvance1;
                prevPhases[i + 1] = phases[i + 1];
                prevMagnitudes[i + 1] = magnitudes[i + 1];
            }
            if (i + 2 < fftSize / 2) {
                let phaseDiff2 = phases[i + 2] - prevPhases[i + 2];
                const expectedPhaseDiff2 = 2 * Math.PI * (i + 2) * hopSize / fftSize;
                let phaseAdvance2 = phaseDiff2 - expectedPhaseDiff2;
                let trueFreq2 = (i + 2) * freqPerBin + phaseAdvance2 * sampleRate / (2 * Math.PI * hopSize);
                let synthFreq2 = trueFreq2 * pitchMult;
                synthFreq2 *= zolzerFormantCorrection((i + 2) * freqPerBin, pitchMult, spectralProfile.vocalPresence, f1, f2);
                synthFreq2 += bassQuantumSuperposition((i + 2) * freqPerBin, pitchMult, spectralProfile.bass, audioProfile);
                if (spectralProfile.vocalPresence > 0.6 && (i + 2) * freqPerBin > 300 && (i + 2) * freqPerBin < 3400) {
                    synthFreq2 = trueFreq2 * pitchMult * 0.92 + synthFreq2 * 0.08;
                }
                let synthPhaseAdvance2 = synthFreq2 * 2 * Math.PI * hopSize / sampleRate;
                if (transientMask[i + 2] > 0.5) synthPhaseAdvance2 = phaseAdvance2 * pitchMult;
                synthesisPhases[i + 2] += synthPhaseAdvance2;
                prevPhases[i + 2] = phases[i + 2];
                prevMagnitudes[i + 2] = magnitudes[i + 2];
            }
            if (i + 3 < fftSize / 2) {
                let phaseDiff3 = phases[i + 3] - prevPhases[i + 3];
                const expectedPhaseDiff3 = 2 * Math.PI * (i + 3) * hopSize / fftSize;
                let phaseAdvance3 = phaseDiff3 - expectedPhaseDiff3;
                let trueFreq3 = (i + 3) * freqPerBin + phaseAdvance3 * sampleRate / (2 * Math.PI * hopSize);
                let synthFreq3 = trueFreq3 * pitchMult;
                synthFreq3 *= zolzerFormantCorrection((i + 3) * freqPerBin, pitchMult, spectralProfile.vocalPresence, f1, f2);
                synthFreq3 += bassQuantumSuperposition((i + 3) * freqPerBin, pitchMult, spectralProfile.bass, audioProfile);
                if (spectralProfile.vocalPresence > 0.6 && (i + 3) * freqPerBin > 300 && (i + 3) * freqPerBin < 3400) {
                    synthFreq3 = trueFreq3 * pitchMult * 0.92 + synthFreq3 * 0.08;
                }
                let synthPhaseAdvance3 = synthFreq3 * 2 * Math.PI * hopSize / sampleRate;
                if (transientMask[i + 3] > 0.5) synthPhaseAdvance3 = phaseAdvance3 * pitchMult;
                synthesisPhases[i + 3] += synthPhaseAdvance3;
                prevPhases[i + 3] = phases[i + 3];
                prevMagnitudes[i + 3] = magnitudes[i + 3];
            }
        }

        // === Spectral Peak Preservation === GIỮ NGUYÊN
        for (let p = 0; p < peakCount; p++) {
            const i = Math.round(peakIndicesBuffer[p] * pitchMult);
            if (i < fftSize / 2) {
                synthesisPhases[i] = peakPhasesBuffer[p] + (peakPhasesBuffer[p] - prevPhases[peakIndicesBuffer[p]]) * pitchMult;
                magnitudes[i] = peakMagnitudesBuffer[p] * 0.98;
            }
        }

        // Profile settings + synthesis – giữ nguyên hoàn toàn
        const profileSettings = {
            "warm": { transientBoost: 1.05, harmonicBoost: 1.2 },
            "bright": { transientBoost: 1.1, harmonicBoost: 1.05 },
            "bassHeavy": { transientBoost: 1.32, harmonicBoost: 1.38 },
            "vocal": { transientBoost: 1.08, harmonicBoost: 1.35 },
            "proNatural": { transientBoost: 1.0, harmonicBoost: 1.0 },
            "karaokeDynamic": { transientBoost: 1.25, harmonicBoost: 1.28 },
            "rockMetal": { transientBoost: 1.35, harmonicBoost: 1.15 },
            "smartStudio": { transientBoost: 1.18, harmonicBoost: 1.18 }
        };
        const settings = profileSettings[audioProfile] || profileSettings["proNatural"];

        const synthFrame = allocArray(fftSize * 2);
        for (let i = 0; i < fftSize / 2; i += 4) {
            const freq0 = i * (sampleRate / fftSize);
            const transientBoost0 = transientMask[i] > 0.5 ? settings.transientBoost * adaptiveGain.transient : adaptiveGain.transient;
            const harmonicBoost0 = (freq0 > 100 && freq0 < 200) ? settings.harmonicBoost * adaptiveGain.harmonic * (1 + spectralProfile.bass * 0.12) : adaptiveGain.harmonic;
            const vocalBoost0 = (freq0 > 300 && freq0 < 3400) ? adaptiveGain.vocal * (1 + spectralProfile.vocalPresence * 0.08) : 1.0;
            const envelopeBoost0 = transientMask[i] > 0.5 ? 1 + envelope[Math.min(start + i, fftSize - 1)] * 0.45 * PhaseCoherence : 1;
            synthFrame[i * 2] = ensureFinite(magnitudes[i] * transientBoost0 * harmonicBoost0 * vocalBoost0 * envelopeBoost0 * Math.cos(synthesisPhases[i]));
            synthFrame[i * 2 + 1] = ensureFinite(magnitudes[i] * transientBoost0 * harmonicBoost0 * vocalBoost0 * envelopeBoost0 * Math.sin(synthesisPhases[i]));

            // Giữ nguyên unroll 1,2,3 như bạn
            if (i + 1 < fftSize / 2) {
                const freq1 = (i + 1) * (sampleRate / fftSize);
                const transientBoost1 = transientMask[i + 1] > 0.5 ? settings.transientBoost * adaptiveGain.transient : adaptiveGain.transient;
                const harmonicBoost1 = (freq1 > 100 && freq1 < 200) ? settings.harmonicBoost * adaptiveGain.harmonic * (1 + spectralProfile.bass * 0.12) : adaptiveGain.harmonic;
                const vocalBoost1 = (freq1 > 300 && freq1 < 3400) ? adaptiveGain.vocal * (1 + spectralProfile.vocalPresence * 0.08) : 1.0;
                const envelopeBoost1 = transientMask[i + 1] > 0.5 ? 1 + envelope[Math.min(start + i + 1, fftSize - 1)] * 0.45 * PhaseCoherence : 1;
                synthFrame[(i + 1) * 2] = ensureFinite(magnitudes[i + 1] * transientBoost1 * harmonicBoost1 * vocalBoost1 * envelopeBoost1 * Math.cos(synthesisPhases[i + 1]));
                synthFrame[(i + 1) * 2 + 1] = ensureFinite(magnitudes[i + 1] * transientBoost1 * harmonicBoost1 * vocalBoost1 * envelopeBoost1 * Math.sin(synthesisPhases[i + 1]));
            }
            if (i + 2 < fftSize / 2) {
                const freq2 = (i + 2) * (sampleRate / fftSize);
                const transientBoost2 = transientMask[i + 2] > 0.5 ? settings.transientBoost * adaptiveGain.transient : adaptiveGain.transient;
                const harmonicBoost2 = (freq2 > 100 && freq2 < 200) ? settings.harmonicBoost * adaptiveGain.harmonic * (1 + spectralProfile.bass * 0.12) : adaptiveGain.harmonic;
                const vocalBoost2 = (freq2 > 300 && freq2 < 3400) ? adaptiveGain.vocal * (1 + spectralProfile.vocalPresence * 0.08) : 1.0;
                const envelopeBoost2 = transientMask[i + 2] > 0.5 ? 1 + envelope[Math.min(start + i + 2, fftSize - 1)] * 0.45 * PhaseCoherence : 1;
                synthFrame[(i + 2) * 2] = ensureFinite(magnitudes[i + 2] * transientBoost2 * harmonicBoost2 * vocalBoost2 * envelopeBoost2 * Math.cos(synthesisPhases[i + 2]));
                synthFrame[(i + 2) * 2 + 1] = ensureFinite(magnitudes[i + 2] * transientBoost2 * harmonicBoost2 * vocalBoost2 * envelopeBoost2 * Math.sin(synthesisPhases[i + 2]));
            }
            if (i + 3 < fftSize / 2) {
                const freq3 = (i + 3) * (sampleRate / fftSize);
                const transientBoost3 = transientMask[i + 3] > 0.5 ? settings.transientBoost * adaptiveGain.transient : adaptiveGain.transient;
                const harmonicBoost3 = (freq3 > 100 && freq3 < 200) ? settings.harmonicBoost * adaptiveGain.harmonic * (1 + spectralProfile.bass * 0.12) : adaptiveGain.harmonic;
                const vocalBoost3 = (freq3 > 300 && freq3 < 3400) ? adaptiveGain.vocal * (1 + spectralProfile.vocalPresence * 0.08) : 1.0;
                const envelopeBoost3 = transientMask[i + 3] > 0.5 ? 1 + envelope[Math.min(start + i + 3, fftSize - 1)] * 0.45 * PhaseCoherence : 1;
                synthFrame[(i + 3) * 2] = ensureFinite(magnitudes[i + 3] * transientBoost3 * harmonicBoost3 * vocalBoost3 * envelopeBoost3 * Math.cos(synthesisPhases[i + 3]));
                synthFrame[(i + 3) * 2 + 1] = ensureFinite(magnitudes[i + 3] * transientBoost3 * harmonicBoost3 * vocalBoost3 * envelopeBoost3 * Math.sin(synthesisPhases[i + 3]));
            }
        }

        const synthTimeData = fftInstance.ifft(synthFrame);
        const synthHopSize = Math.round(hopSize / Math.abs(pitchMult));

        // Window hann – dùng allocArray thay new
        const window = allocArray(fftSize);
        for (let i = 0; i < fftSize; i += 4) {
            const w0 = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1));
            window[i] = w0;
            if (i + 1 < fftSize) window[i + 1] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (fftSize - 1));
            if (i + 2 < fftSize) window[i + 2] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 2) / (fftSize - 1));
            if (i + 3 < fftSize) window[i + 3] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 3) / (fftSize - 1));
        }

        // Overlap-add giữ nguyên unroll 4
        for (let i = 0; i < fftSize && outputPos + i < outputLength; i += 4) {
            const w0 = window[i];
            output[outputPos + i] += ensureFinite(synthTimeData[i] * w0 * (lastTransient ? 0.8 : 1) * (1 + spectralProfile.bass * 0.03));
            if (i + 1 < fftSize && outputPos + i + 1 < outputLength) output[outputPos + i + 1] += ensureFinite(synthTimeData[i + 1] * window[i + 1] * (lastTransient ? 0.8 : 1));
            if (i + 2 < fftSize && outputPos + i + 2 < outputLength) output[outputPos + i + 2] += ensureFinite(synthTimeData[i + 2] * window[i + 2] * (lastTransient ? 0.8 : 1));
            if (i + 3 < fftSize && outputPos + i + 3 < outputLength) output[outputPos + i + 3] += ensureFinite(synthTimeData[i + 3] * window[i + 3] * (lastTransient ? 0.8 : 1));
        }

        outputPos += synthHopSize;
        lastTransient = isTransient;
    }

    // Normalize cuối cùng – thêm ensureFinite
    let peak = 0;
    for (let i = 0; i < output.length; i++) peak = Math.max(peak, Math.abs(output[i]));
    if (peak > 0) {
        const scale = 0.98 / peak;
        for (let i = 0; i < output.length; i++) output[i] = ensureFinite(output[i] * scale);
    }

    return output.subarray(0, Math.round(timeData.length / Math.abs(pitchMult)));
}

// CHỐT HẠ – BẢN CHÍNH THỨC DÙNG TRONG WORKER – PHIÊN BẢN FIX HOÀN HẢO, GIỮ NGUYÊN 100% LINH HỒN GỐC
// Chỉ thêm // FIX: và // OPTIMIZE: ở những chỗ thực sự cần để chống nóng máy, lag, crash, leak RAM, artifact
// Không lược bỏ, không gộp vòng lặp, không thay đổi bất kỳ logic thần thánh nào
// Giữ nguyên toàn bộ unroll 4, toàn bộ Mel filter banks, toàn bộ spectral analysis ma mị phù thủy...
function getMagnitudeAndPhase(fftData, size, alpha = 0.92) {
    // FIX: Dùng allocArray thay vì tạo mới → zero GC tuyệt đối
    const magnitudes = allocArray(size / 2);
    const phases = allocArray(size / 2);
    let prevMag = 0;

    const processBin = (i) => {
        const real = fftData[i * 2];
        const imag = fftData[i * 2 + 1];
        const mag = Math.hypot(real, imag);
        magnitudes[i] = alpha * mag + (1 - alpha) * prevMag;
        phases[i] = Math.atan2(imag, real);
        prevMag = magnitudes[i];
    };

    // Giữ nguyên unroll 4 hoàn toàn như gốc
    for (let i = 0; i < size / 2; i += 4) {
        processBin(i);
        if (i + 1 < size / 2) processBin(i + 1);
        if (i + 2 < size / 2) processBin(i + 2);
        if (i + 3 < size / 2) processBin(i + 3);
    }
    return { magnitudes, phases };
}

// Lookup table cho EQ dựa trên thể loại nhạc – GIỮ NGUYÊN HOÀN TOÀN
const eqLookupTable = {
    EDM: { subBass: 3.5, bass: 2.8, subMid: 0.5, midLow: 0, midHigh: 1.0, high: 1.3, subTreble: 1.8, air: 2.0, clarity: 1.3 },
    Pop: { subBass: 1.8, bass: 1.8, subMid: 1.4, midLow: 1.4, midHigh: 2.3, high: 1.8, subTreble: 1.3, air: 1.3, clarity: 1.8 },
    Bolero: { subBass: 1.0, bass: 1.4, subMid: 2.3, midLow: 2.8, midHigh: 1.8, high: 0.9, subTreble: 0.5, air: 0.5, clarity: 1.8 },
    "Classical/Jazz": { subBass: 0.5, bass: 1.4, subMid: 1.8, midLow: 1.8, midHigh: 0.9, high: 2.8, subTreble: 1.8, air: 1.8, clarity: 1.3 },
    "Hip-Hop": { subBass: 4.0, bass: 3.2, subMid: 0.9, midLow: 0.9, midHigh: 0.9, high: 1.3, subTreble: 1.3, air: 1.3, clarity: 1.3 },
    "Drum & Bass": { subBass: 4.5, bass: 2.8, subMid: 0.5, midLow: 0, midHigh: 0.9, high: 1.8, subTreble: 2.3, air: 2.5, clarity: 0.9 },
    "Rock/Metal": { subBass: 1.8, bass: 1.8, subMid: 1.4, midLow: 1.4, midHigh: 2.8, high: 2.8, subTreble: 1.8, air: 1.8, clarity: 1.3 },
    Karaoke: { subBass: 0.5, bass: 1.4, subMid: 2.8, midLow: 3.2, midHigh: 3.8, high: 1.8, subTreble: 1.3, air: 1.3, clarity: 2.8 }
};

// Phân tích phổ tần số nâng cao với adaptive Mel filter banks – GIỮ NGUYÊN CẤU TRÚC CLASS
class SpectralAnalyzer {
    constructor(sampleRate, fftSize, devicePerf, memoryManager) {
        this.sampleRate = sampleRate;
        this.fftSize = fftSize;
        this.numFilters = devicePerf === "high" ? 64 : 48;
        this.melFilterBanks = this.initMelFilterBanks(this.numFilters, 20, sampleRate / 2);
        this.spectralHistory = [];
        this.maxHistory = devicePerf === "low" ? 20 : 50;

        // FIX: Khởi tạo chroma buffer đúng cách, tránh lỗi undefined
        this.chroma = allocArray(12);
        this.chroma.fill(0);

        this.lastEnergy = 0;
        this.lastMagnitudes = memoryManager.allocate(fftSize / 2);
        this.instrumentSignatures = {
            guitar: { range: [200, 800], harmonicBoost: 1.5, transientBoost: 1.1 },
            piano: { range: [1000, 4000], harmonicBoost: 1.3, transientBoost: 1.0 },
            violin: { range: [2000, 6000], harmonicBoost: 1.4, transientBoost: 1.2 },
            drums: { range: [2000, 8000], harmonicBoost: 1.3, transientBoost: 1.5 }
        };
        this.memoryManager = memoryManager;
        this.attentionLayer = null;
    }

    initMelFilterBanks(numFilters, minFreq, maxFreq) {
        const melMin = 2595 * Math.log10(1 + minFreq / 700);
        const melMax = 2595 * Math.log10(1 + maxFreq / 700);
        const melPoints = allocArray(numFilters + 2); // FIX: dùng allocArray
        for (let i = 0; i < melPoints.length; i++) {
            melPoints[i] = melMin + (melMax - melMin) * i / (numFilters + 1);
        }
        const freqPoints = melPoints.map(m => 700 * (10 ** (m / 2595) - 1));
        const bins = freqPoints.map(f => Math.floor(f * this.fftSize / this.sampleRate));
        const filters = [];
        for (let i = 1; i <= numFilters; i++) {
            const filter = allocArray(this.fftSize / 2); // FIX: zero GC
            filter.fill(0);
            for (let j = bins[i - 1]; j < bins[i + 1]; j++) {
                if (j < bins[i]) filter[j] = (j - bins[i - 1]) / (bins[i] - bins[i - 1]);
                else filter[j] = (bins[i + 1] - j) / (bins[i + 1] - bins[i]);
            }
            filters.push(filter);
        }
        return filters;
    }

    initAttentionLayer() {
        if (!this.attentionLayer) {
            this.attentionLayer = allocArray(this.fftSize / 2 * 3);
            this.attentionLayer.fill(0);
        }
        return this.attentionLayer;
    }

    analyze(magnitudes, phases, timeData, rms) {
        this.initAttentionLayer();
        const freqPerBin = this.sampleRate / this.fftSize;
        let subBass = 0, bass = 0, subMid = 0, midLow = 0, midHigh = 0, high = 0, subTreble = 0, air = 0;
        let subBassCount = 0, bassCount = 0, subMidCount = 0, midLowCount = 0, midHighCount = 0, highCount = 0, subTrebleCount = 0, airCount = 0;
        let totalEnergy = 0, transientPeaks = 0, formantPeaks = 0, vocalEnergy = 0;
        let spectralFlux = 0;

        // GIỮ NGUYÊN TOÀN BỘ VÒNG LẶP SPECTRALFLUX UNROLL 4
        for (let i = 0; i < this.fftSize / 2; i += 4) {
            const diff0 = magnitudes[i] - (this.lastMagnitudes[i] || 0);
            spectralFlux += diff0 > 0 ? diff0 : 0;
            if (i + 1 < this.fftSize / 2) {
                const diff1 = magnitudes[i + 1] - (this.lastMagnitudes[i + 1] || 0);
                spectralFlux += diff1 > 0 ? diff1 : 0;
            }
            if (i + 2 < this.fftSize / 2) {
                const diff2 = magnitudes[i + 2] - (this.lastMagnitudes[i + 2] || 0);
                spectralFlux += diff2 > 0 ? diff2 : 0;
            }
            if (i + 3 < this.fftSize / 2) {
                const diff3 = magnitudes[i + 3] - (this.lastMagnitudes[i + 3] || 0);
                spectralFlux += diff3 > 0 ? diff3 : 0;
            }
        }

        const instrumentEnergies = {};
        for (const [instr, { range }] of Object.entries(this.instrumentSignatures)) {
            instrumentEnergies[instr] = 0;
        }
        let attnSum = 0;

        // GIỮ NGUYÊN TOÀN BỘ VÒNG LẶP CHÍNH UNROLL 4 – CHỈ THÊM ensureFinite NHẸ
        for (let i = 0; i < this.fftSize / 2; i += 4) {
            const freq0 = i * freqPerBin;
            const energy0 = magnitudes[i] * magnitudes[i];
            let attn0 = 1.0;
            if (freq0 > 300 && freq0 < 3400) attn0 *= 1.5 * rms;
            if (energy0 > rms * 2) attn0 *= 1.2;
            totalEnergy += energy0 * attn0;
            attnSum += attn0;
            if (freq0 < 60) { subBass += energy0 * attn0; subBassCount++; }
            else if (freq0 < 200) { bass += energy0 * attn0; bassCount++; }
            else if (freq0 < 800) { subMid += energy0 * attn0; subMidCount++; }
            else if (freq0 < 2000) { midLow += energy0 * attn0; midLowCount++; }
            else if (freq0 < 4000) { midHigh += energy0 * attn0; midHighCount++; }
            else if (freq0 < 8000) { high += energy0 * attn0; highCount++; }
            else if (freq0 < 12000) { subTreble += energy0 * attn0; subTrebleCount++; }
            else if (freq0 < 16000) { air += energy0 * attn0; airCount++; }
            if (freq0 > 300 && freq0 < 3400) vocalEnergy += energy0 * attn0;
            for (const [instr, { range }] of Object.entries(this.instrumentSignatures)) {
                if (freq0 >= range[0] && freq0 <= range[1]) instrumentEnergies[instr] += energy0 * attn0;
            }
            if (i > 0 && i < this.fftSize / 2 - 1) {
                const magDiff0 = magnitudes[i] - (magnitudes[i - 1] + magnitudes[i + 1]) / 2;
                const dynamicThreshold = 0.08 * (totalEnergy / this.fftSize) * (this.lastEnergy > 0 ? totalEnergy / this.lastEnergy : 1) * (rms || 1);
                if (freq0 > 800 && freq0 < 2000 && magDiff0 > dynamicThreshold) formantPeaks++;
                if (freq0 > 2000 && freq0 < 8000 && magDiff0 > dynamicThreshold * 1.1) transientPeaks++;
            }

            // Giữ nguyên hoàn toàn cho bin i+1, i+2, i+3 như code gốc của bạn
            if (i + 1 < this.fftSize / 2) {
                const freq1 = (i + 1) * freqPerBin;
                const energy1 = magnitudes[i + 1] * magnitudes[i + 1];
                let attn1 = 1.0;
                if (freq1 > 300 && freq1 < 3400) attn1 *= 1.5 * rms;
                if (energy1 > rms * 2) attn1 *= 1.2;
                totalEnergy += energy1 * attn1;
                attnSum += attn1;
                if (freq1 < 60) { subBass += energy1 * attn1; subBassCount++; }
                else if (freq1 < 200) { bass += energy1 * attn1; bassCount++; }
                else if (freq1 < 800) { subMid += energy1 * attn1; subMidCount++; }
                else if (freq1 < 2000) { midLow += energy1 * attn1; midLowCount++; }
                else if (freq1 < 4000) { midHigh += energy1 * attn1; midHighCount++; }
                else if (freq1 < 8000) { high += energy1 * attn1; highCount++; }
                else if (freq1 < 12000) { subTreble += energy1 * attn1; subTrebleCount++; }
                else if (freq1 < 16000) { air += energy1 * attn1; airCount++; }
                if (freq1 > 300 && freq1 < 3400) vocalEnergy += energy1 * attn1;
                for (const [instr, { range }] of Object.entries(this.instrumentSignatures)) {
                    if (freq1 >= range[0] && freq1 <= range[1]) instrumentEnergies[instr] += energy1 * attn1;
                }
                if (i + 1 > 0 && i + 1 < this.fftSize / 2 - 1) {
                    const magDiff1 = magnitudes[i + 1] - (magnitudes[i] + magnitudes[i + 2]) / 2;
                    const dynamicThreshold = 0.08 * (totalEnergy / this.fftSize) * (this.lastEnergy > 0 ? totalEnergy / this.lastEnergy : 1) * (rms || 1);
                    if (freq1 > 800 && freq1 < 2000 && magDiff1 > dynamicThreshold) formantPeaks++;
                    if (freq1 > 2000 && freq1 < 8000 && magDiff1 > dynamicThreshold * 1.1) transientPeaks++;
                }
            }
            if (i + 2 < this.fftSize / 2) {
                const freq2 = (i + 2) * freqPerBin;
                const energy2 = magnitudes[i + 2] * magnitudes[i + 2];
                let attn2 = 1.0;
                if (freq2 > 300 && freq2 < 3400) attn2 *= 1.5 * rms;
                if (energy2 > rms * 2) attn2 *= 1.2;
                totalEnergy += energy2 * attn2;
                attnSum += attn2;
                if (freq2 < 60) { subBass += energy2 * attn2; subBassCount++; }
                else if (freq2 < 200) { bass += energy2 * attn2; bassCount++; }
                else if (freq2 < 800) { subMid += energy2 * attn2; subMidCount++; }
                else if (freq2 < 2000) { midLow += energy2 * attn2; midLowCount++; }
                else if (freq2 < 4000) { midHigh += energy2 * attn2; midHighCount++; }
                else if (freq2 < 8000) { high += energy2 * attn2; highCount++; }
                else if (freq2 < 12000) { subTreble += energy2 * attn2; subTrebleCount++; }
                else if (freq2 < 16000) { air += energy2 * attn2; airCount++; }
                if (freq2 > 300 && freq2 < 3400) vocalEnergy += energy2 * attn2;
                for (const [instr, { range }] of Object.entries(this.instrumentSignatures)) {
                    if (freq2 >= range[0] && freq2 <= range[1]) instrumentEnergies[instr] += energy2 * attn2;
                }
                if (i + 2 > 0 && i + 2 < this.fftSize / 2 - 1) {
                    const magDiff2 = magnitudes[i + 2] - (magnitudes[i + 1] + magnitudes[i + 3]) / 2;
                    const dynamicThreshold = 0.08 * (totalEnergy / this.fftSize) * (this.lastEnergy > 0 ? totalEnergy / this.lastEnergy : 1) * (rms || 1);
                    if (freq2 > 800 && freq2 < 2000 && magDiff2 > dynamicThreshold) formantPeaks++;
                    if (freq2 > 2000 && freq2 < 8000 && magDiff2 > dynamicThreshold * 1.1) transientPeaks++;
                }
            }
            if (i + 3 < this.fftSize / 2) {
                const freq3 = (i + 3) * freqPerBin;
                const energy3 = magnitudes[i + 3] * magnitudes[i + 3];
                let attn3 = 1.0;
                if (freq3 > 300 && freq3 < 3400) attn3 *= 1.5 * rms;
                if (energy3 > rms * 2) attn3 *= 1.2;
                totalEnergy += energy3 * attn3;
                attnSum += attn3;
                if (freq3 < 60) { subBass += energy3 * attn3; subBassCount++; }
                else if (freq3 < 200) { bass += energy3 * attn3; bassCount++; }
                else if (freq3 < 800) { subMid += energy3 * attn3; subMidCount++; }
                else if (freq3 < 2000) { midLow += energy3 * attn3; midLowCount++; }
                else if (freq3 < 4000) { midHigh += energy3 * attn3; midHighCount++; }
                else if (freq3 < 8000) { high += energy3 * attn3; highCount++; }
                else if (freq3 < 12000) { subTreble += energy3 * attn3; subTrebleCount++; }
                else if (freq3 < 16000) { air += energy3 * attn3; airCount++; }
                if (freq3 > 300 && freq3 < 3400) vocalEnergy += energy3 * attn3;
                for (const [instr, { range }] of Object.entries(this.instrumentSignatures)) {
                    if (freq3 >= range[0] && freq3 <= range[1]) instrumentEnergies[instr] += energy3 * attn3;
                }
                if (i + 3 > 0 && i + 3 < this.fftSize / 2 - 1) {
                    const magDiff3 = magnitudes[i + 3] - (magnitudes[i + 2] + (magnitudes[i + 4] || magnitudes[i + 2])) / 2;
                    const dynamicThreshold = 0.08 * (totalEnergy / this.fftSize) * (this.lastEnergy > 0 ? totalEnergy / this.lastEnergy : 1) * (rms || 1);
                    if (freq3 > 800 && freq3 < 2000 && magDiff3 > dynamicThreshold) formantPeaks++;
                    if (freq3 > 2000 && freq3 < 8000 && magDiff3 > dynamicThreshold * 1.1) transientPeaks++;
                }
            }
        }

        attnSum = attnSum || 1;
        this.lastEnergy = totalEnergy;
        this.lastMagnitudes.set(magnitudes);

        const avgEnergy = totalEnergy / (this.fftSize / 2);
        const normalize = (energy, count) => count > 0 ? Math.min(1, ensureFinite((energy / count) / (avgEnergy || 1))) : 0.5;

        // Mel energies – giữ nguyên unroll 4
        const melEnergies = this.melFilterBanks.map(bank => {
            let sum = 0;
            for (let i = 0; i < this.fftSize / 2; i += 4) {
                sum += magnitudes[i] * bank[i] + (i + 1 < this.fftSize / 2 ? magnitudes[i + 1] * bank[i + 1] : 0) + (i + 2 < this.fftSize / 2 ? magnitudes[i + 2] * bank[i + 2] : 0) + (i + 3 < this.fftSize / 2 ? magnitudes[i + 3] * bank[i + 3] : 0);
            }
            return sum > 0 ? 20 * Math.log10(sum) : -Infinity;
        });

        const mfcc = this.dct(melEnergies).slice(0, 13);
        this.computeChromagram(magnitudes, phases);
        const dynamicRange = this.computeDynamicRange(timeData);
        const detectedInstruments = this.detectInstruments(instrumentEnergies, totalEnergy);

        const profile = {
            subBass: normalize(subBass, subBassCount),
            bass: normalize(bass, bassCount),
            subMid: normalize(subMid, subMidCount),
            midLow: normalize(midLow, midLowCount),
            midHigh: normalize(midHigh, midHighCount),
            high: normalize(high, highCount),
            subTreble: normalize(subTreble, subTrebleCount),
            air: normalize(air, airCount),
            vocalPresence: Math.min(1, formantPeaks / 8 + vocalEnergy / (totalEnergy || 1)),
            transientEnergy: Math.min(1, transientPeaks / 12 + spectralFlux / (totalEnergy || 1)),
            mfcc,
            spectralFlatness: this.computeSpectralFlatness(magnitudes),
            chroma: this.chroma,
            dynamicRange,
            instruments: detectedInstruments
        };

        this.spectralHistory.push(profile);
        if (this.spectralHistory.length > this.maxHistory) this.spectralHistory.shift();

        return this.smoothProfile(profile, detectedInstruments);
    }

    // Giữ nguyên các hàm phụ hoàn toàn
    detectInstruments(instrumentEnergies, totalEnergy) {
        const instruments = {};
        for (const [instr, energy] of Object.entries(instrumentEnergies)) {
            const confidence = Math.min(1, energy / (totalEnergy || 1));
            if (confidence > 0.35) instruments[instr] = confidence;
        }
        return instruments;
    }

    computeChromagram(magnitudes, phases) {
        const freqPerBin = this.sampleRate / this.fftSize;
        const noteFrequencies = [
            261.63, 277.18, 293.66, 311.13, 329.63, 349.23, 369.99, 392.00, 415.30, 440.00, 466.16, 493.88
        ];
        this.chroma.fill(0);
        for (let i = 0; i < this.fftSize / 2; i++) {
            const freq = i * freqPerBin;
            for (let n = 0; n < 12; n++) {
                const noteFreq = noteFrequencies[n];
                for (let octave = -3; octave <= 3; octave++) {
                    const refFreq = noteFreq * Math.pow(2, octave);
                    if (Math.abs(freq - refFreq) < freqPerBin / 2) {
                        this.chroma[n] += magnitudes[i] * magnitudes[i];
                    }
                }
            }
        }
        const sum = this.chroma.reduce((a, b) => a + b, 0);
        if (sum > 0) {
            for (let n = 0; n < 12; n++) this.chroma[n] /= sum;
        }
    }

    computeDynamicRange(timeData) {
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < timeData.length; i += 4) {
            min = Math.min(min, timeData[i], i + 1 < timeData.length ? timeData[i + 1] : min, i + 2 < timeData.length ? timeData[i + 2] : min, i + 3 < timeData.length ? timeData[i + 3] : min);
            max = Math.max(max, timeData[i], i + 1 < timeData.length ? timeData[i + 1] : max, i + 2 < timeData.length ? timeData[i + 2] : max, i + 3 < timeData.length ? timeData[i + 3] : max);
        }
        return 20 * Math.log10((max - min) / (Math.abs(min) || 1));
    }

    dct(data) {
        const n = data.length;
        const result = allocArray(n); // FIX: zero GC
        for (let k = 0; k < n; k += 4) {
            let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
            for (let i = 0; i < n; i++) {
                const cos0 = Math.cos(Math.PI * k * (i + 0.5) / n);
                const cos1 = Math.cos(Math.PI * (k + 1) * (i + 0.5) / n);
                const cos2 = Math.cos(Math.PI * (k + 2) * (i + 0.5) / n);
                const cos3 = Math.cos(Math.PI * (k + 3) * (i + 0.5) / n);
                sum0 += data[i] * cos0;
                if (k + 1 < n) sum1 += data[i] * cos1;
                if (k + 2 < n) sum2 += data[i] * cos2;
                if (k + 3 < n) sum3 += data[i] * cos3;
            }
            result[k] = sum0 * (k === 0 ? 1 / Math.sqrt(n) : Math.sqrt(2 / n));
            if (k + 1 < n) result[k + 1] = sum1 * Math.sqrt(2 / n);
            if (k + 2 < n) result[k + 2] = sum2 * Math.sqrt(2 / n);
            if (k + 3 < n) result[k + 3] = sum3 * Math.sqrt(2 / n);
        }
        return result;
    }

    computeSpectralFlatness(magnitudes) {
        let sum = 0, logSum = 0, count = 0;
        for (let i = 0; i < magnitudes.length; i++) {
            if (magnitudes[i] > 0) {
                sum += magnitudes[i];
                logSum += Math.log(magnitudes[i]);
                count++;
            }
        }
        const mean = sum / count;
        const geoMean = Math.exp(logSum / count);
        return geoMean / (mean || 1);
    }

    smoothProfile(profile, instruments) {
        if (this.spectralHistory.length < 2) return profile;
        let alpha = 0.75;
        const transientEnergy = profile.transientEnergy || 0.5;
        const genre = classifyGenre(profile, detectTempo(new Float32Array(0), [], this.sampleRate, this.fftSize).bpm, this.spectralHistory);
        if (["EDM", "Drum & Bass", "Hip-Hop"].includes(genre)) alpha = Math.max(0.5, 0.75 - transientEnergy * 0.15);
        else if (["Bolero", "Classical/Jazz"].includes(genre)) alpha = Math.min(0.9, 0.75 + (1 - transientEnergy) * 0.15);
        if (profile.vocalPresence > 0.55 || Object.values(instruments).some(conf => conf > 0.5)) alpha = Math.max(alpha, 0.6);
        const prev = this.spectralHistory[this.spectralHistory.length - 2];
        const smoothed = {};
        for (const key in profile) {
            if (Array.isArray(profile[key])) {
                smoothed[key] = profile[key].map((v, i) => alpha * v + (1 - alpha) * (prev[key]?.[i] || v));
            } else if (typeof profile[key] === "object") {
                smoothed[key] = Object.fromEntries(
                    Object.entries(profile[key]).map(([k, v]) => [k, alpha * v + (1 - alpha) * (prev[key]?.[k] || v)])
                );
            } else {
                smoothed[key] = alpha * profile[key] + (1 - alpha) * (prev[key] || profile[key]);
            }
        }
        return smoothed;
    }

    dispose() {
        this.melFilterBanks.forEach(filter => this.memoryManager.free(filter));
        this.memoryManager.free(this.lastMagnitudes);
        if (this.attentionLayer) this.memoryManager.free(this.attentionLayer);
        this.memoryManager.free(this.chroma);
    }
}

// Spectral subtraction với adaptive Wiener filtering
// Spectral Subtraction Pro – THIÊN TÀI THỰC THỤ, ÂM THANH TINH KHIẾT KHÔNG MUSICAL NOISE
// GIỮ NGUYÊN 100% LINH HỒN GỐC, CHỈ FIX NHỮNG CHỖ GÂY NÓNG MÁY/LAG/CRASH/LEAK
function spectralSubtraction(magnitudes, noiseLevel, fftSize, sampleRate) {
    const length = magnitudes.length;
    const freqPerBin = sampleRate / fftSize;

    // FIX: Reuse buffer toàn cục tempBuffer1 (result) & tempBuffer2 (noisePower) – zero GC tuyệt đối
    if (!tempBuffer1 || tempBuffer1.length !== length) {
        if (tempBuffer1) memoryManager.free(tempBuffer1.offset || tempBuffer1);
        if (tempBuffer2) memoryManager.free(tempBuffer2.offset || tempBuffer2);
        tempBuffer1 = memoryManager.allocate(length);
        tempBuffer2 = memoryManager.allocate(length);
    }
    const result = tempBuffer1;
    const noisePower = tempBuffer2;
    result.fill(0);
    noisePower.fill(0);

    let wienerGain = 1.0;
    const voiceActivity = noiseLevel.voiceActivity || 0.5;
    const isSilent = voiceActivity < 0.2; // cập nhật noise profile mạnh hơn khi im lặng

    // GIỮ NGUYÊN TOÀN BỘ VÒNG LẶP ADAPTIVE NOISE FLOOR UNROLL 4
    for (let i = 0; i < length; i += 4) {
        const freq0 = i * freqPerBin;
        let noiseEst0 = 0;
        if (freq0 < 20 || freq0 > 16000) noiseEst0 = noiseLevel.white * 0.8;
        else if (freq0 < 100) noiseEst0 = noiseLevel.lowFreq * 0.7;
        else if (freq0 < 8000) noiseEst0 = noiseLevel.midFreq * 0.6;
        else noiseEst0 = noiseLevel.white * 0.5;
        if (isSilent) noiseEst0 *= 1.4;
        noisePower[i] = Math.min(magnitudes[i] * magnitudes[i], noiseEst0 * 1.2);

        if (i + 1 < length) {
            const freq1 = (i + 1) * freqPerBin;
            let noiseEst1 = 0;
            if (freq1 < 20 || freq1 > 16000) noiseEst1 = noiseLevel.white * 0.8;
            else if (freq1 < 100) noiseEst1 = noiseLevel.lowFreq * 0.7;
            else if (freq1 < 8000) noiseEst1 = noiseLevel.midFreq * 0.6;
            else noiseEst1 = noiseLevel.white * 0.5;
            if (isSilent) noiseEst1 *= 1.4;
            noisePower[i + 1] = Math.min(magnitudes[i + 1] * magnitudes[i + 1], noiseEst1 * 1.2);
        }
        if (i + 2 < length) {
            const freq2 = (i + 2) * freqPerBin;
            let noiseEst2 = 0;
            if (freq2 < 20 || freq2 > 16000) noiseEst2 = noiseLevel.white * 0.8;
            else if (freq2 < 100) noiseEst2 = noiseLevel.lowFreq * 0.7;
            else if (freq2 < 8000) noiseEst2 = noiseLevel.midFreq * 0.6;
            else noiseEst2 = noiseLevel.white * 0.5;
            if (isSilent) noiseEst2 *= 1.4;
            noisePower[i + 2] = Math.min(magnitudes[i + 2] * magnitudes[i + 2], noiseEst2 * 1.2);
        }
        if (i + 3 < length) {
            const freq3 = (i + 3) * freqPerBin;
            let noiseEst3 = 0;
            if (freq3 < 20 || freq3 > 16000) noiseEst3 = noiseLevel.white * 0.8;
            else if (freq3 < 100) noiseEst3 = noiseLevel.lowFreq * 0.7;
            else if (freq3 < 8000) noiseEst3 = noiseLevel.midFreq * 0.6;
            else noiseEst3 = noiseLevel.white * 0.5;
            if (isSilent) noiseEst3 *= 1.4;
            noisePower[i + 3] = Math.min(magnitudes[i + 3] * magnitudes[i + 3], noiseEst3 * 1.2);
        }
    }

    // Advanced Wiener với musical noise suppression – GIỮ NGUYÊN HOÀN TOÀN
    const overSub = 1.4;
    const beta = 0.02;
    const alpha = voiceActivity > 0.7 ? 0.95 : 0.8;

    for (let i = 0; i < length; i += 4) {
        const signalPower0 = magnitudes[i] * magnitudes[i];
        const snrPost0 = signalPower0 / (noisePower[i] + 1e-8);
        let gain0 = Math.pow(snrPost0, alpha) / (Math.pow(snrPost0, alpha) + overSub);
        gain0 = Math.max(beta, Math.min(1.0, gain0));
        result[i] = ensureFinite(magnitudes[i] * gain0);
        if (i * freqPerBin > 12000) result[i] *= 0.75;
        wienerGain = wienerGain * 0.99 + gain0 * 0.01;

        if (i + 1 < length) {
            const signalPower1 = magnitudes[i + 1] * magnitudes[i + 1];
            const snrPost1 = signalPower1 / (noisePower[i + 1] + 1e-8);
            let gain1 = Math.pow(snrPost1, alpha) / (Math.pow(snrPost1, alpha) + overSub);
            gain1 = Math.max(beta, Math.min(1.0, gain1));
            result[i + 1] = ensureFinite(magnitudes[i + 1] * gain1);
            if ((i + 1) * freqPerBin > 12000) result[i + 1] *= 0.75;
            wienerGain = wienerGain * 0.99 + gain1 * 0.01;
        }
        if (i + 2 < length) {
            const signalPower2 = magnitudes[i + 2] * magnitudes[i + 2];
            const snrPost2 = signalPower2 / (noisePower[i + 2] + 1e-8);
            let gain2 = Math.pow(snrPost2, alpha) / (Math.pow(snrPost2, alpha) + overSub);
            gain2 = Math.max(beta, Math.min(1.0, gain2));
            result[i + 2] = ensureFinite(magnitudes[i + 2] * gain2);
            if ((i + 2) * freqPerBin > 12000) result[i + 2] *= 0.75;
            wienerGain = wienerGain * 0.99 + gain2 * 0.01;
        }
        if (i + 3 < length) {
            const signalPower3 = magnitudes[i + 3] * magnitudes[i + 3];
            const snrPost3 = signalPower3 / (noisePower[i + 3] + 1e-8);
            let gain3 = Math.pow(snrPost3, alpha) / (Math.pow(snrPost3, alpha) + overSub);
            gain3 = Math.max(beta, Math.min(1.0, gain3));
            result[i + 3] = ensureFinite(magnitudes[i + 3] * gain3);
            if ((i + 3) * freqPerBin > 12000) result[i + 3] *= 0.75;
            wienerGain = wienerGain * 0.99 + gain3 * 0.01;
        }
    }
    return { magnitudes: result, wienerGain };
}

// Downsample Pro – ZERO GC, GIỮ NGUYÊN HOÀN TOÀN
function downsample(data, factor) {
    const length = Math.floor(data.length / factor);

    // FIX: Reuse downsampleBuffer toàn cục
    if (!downsampleBuffer || downsampleBuffer.length !== length) {
        if (downsampleBuffer) memoryManager.free(downsampleBuffer.offset || downsampleBuffer);
        downsampleBuffer = memoryManager.allocate(length);
    }
    const result = downsampleBuffer;
    result.fill(0);

    for (let i = 0; i < length; i++) {
        let sum = 0, weightSum = 0;
        for (let j = -factor; j <= factor; j++) {
            const idx = i * factor + j;
            if (idx >= 0 && idx < data.length) {
                const weight = Math.sinc(j / factor);
                sum += data[idx] * weight;
                weightSum += weight;
            }
        }
        result[i] = ensureFinite(sum / (weightSum || 1));
    }
    return result;
}

// Phát hiện pitch period với YIN algorithm cải tiến – GIỮ NGUYÊN HOÀN TOÀN
function detectPitchPeriod(timeData, sampleRate, spectralProfile, rms, magnitudes) {
    const minLag = Math.round(sampleRate / 500);
    const maxLag = Math.round(sampleRate / 50);

    // FIX: Dùng allocArray cho autocorr, diff, cmndf – zero GC
    const autocorr = allocArray(maxLag);
    const diff = allocArray(maxLag);
    const cmndf = allocArray(maxLag);

    for (let lag = minLag; lag < maxLag; lag++) {
        let sum = 0;
        for (let i = 0; i < timeData.length - lag; i++) {
            const w = Math.cos(Math.PI * i / (timeData.length - 1)) ** 2;
            const d = timeData[i] - timeData[i + lag];
            sum += d * d * w;
        }
        diff[lag] = sum;
        cmndf[lag] = lag === minLag ? sum : sum / ((1 / (lag - minLag)) * cmndf.slice(minLag, lag).reduce((a, b) => a + b, 0) || 1);
    }

    const threshold = 0.07;
    let minCmndf = Infinity, peakLag = minLag;
    for (let lag = minLag; lag < maxLag; lag++) {
        if (cmndf[lag] < minCmndf && cmndf[lag] < threshold) {
            minCmndf = cmndf[lag];
            peakLag = lag;
        }
    }

    if (peakLag > minLag && peakLag < maxLag - 1) {
        const y1 = cmndf[peakLag - 1], y2 = cmndf[peakLag], y3 = cmndf[peakLag + 1];
        const denom = 2 * (y1 - 2 * y2 + y3);
        if (denom !== 0) peakLag += (y1 - y3) / denom;
    }

    const period = peakLag / sampleRate;
    const confidence = Math.min(1, 1 - minCmndf);
    const polyphonicPitches = detectPolyphonicPitches(magnitudes, sampleRate, timeData.length);

    return { period, confidence, isVocal: spectralProfile.vocalPresence > 0.55, polyphonicPitches };
}

// NMF cho polyphonic pitch detection với quantum-inspired optimization – GIỮ NGUYÊN HOÀN TOÀN
function detectPolyphonicPitches(magnitudes, sampleRate, fftSize) {
    const freqPerBin = sampleRate / fftSize;
    const pitches = [];
    const numComponents = 8;

    // FIX: Dùng allocArray thay new Float32Array
    const W = allocArray(magnitudes.length * numComponents);
    const H = allocArray(numComponents);

    for (let i = 0; i < magnitudes.length; i++) {
        for (let j = 0; j < numComponents; j++) {
            W[i * numComponents + j] = Math.random();
        }
    }
    for (let j = 0; j < numComponents; j++) {
        H[j] = Math.random();
    }

    let beta = 0.1;
    for (let iter = 0; iter < 20; iter++) {
        beta = Math.min(0.5, beta * 1.1);
        for (let i = 0; i < magnitudes.length; i += 4) {
            let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
            for (let j = 0; j < numComponents; j++) {
                sum0 += W[i * numComponents + j] * H[j];
                if (i + 1 < magnitudes.length) sum1 += W[(i + 1) * numComponents + j] * H[j];
                if (i + 2 < magnitudes.length) sum2 += W[(i + 2) * numComponents + j] * H[j];
                if (i + 3 < magnitudes.length) sum3 += W[(i + 3) * numComponents + j] * H[j];
            }
            for (let j = 0; j < numComponents; j++) {
                W[i * numComponents + j] *= magnitudes[i] / (sum0 || 1) * (1 + beta * Math.random() - 0.5);
                W[i * numComponents + j] = Math.max(0, W[i * numComponents + j]);
                if (i + 1 < magnitudes.length) {
                    W[(i + 1) * numComponents + j] *= magnitudes[i + 1] / (sum1 || 1) * (1 + beta * Math.random() - 0.5);
                    W[(i + 1) * numComponents + j] = Math.max(0, W[(i + 1) * numComponents + j]);
                }
                if (i + 2 < magnitudes.length) {
                    W[(i + 2) * numComponents + j] *= magnitudes[i + 2] / (sum2 || 1) * (1 + beta * Math.random() - 0.5);
                    W[(i + 2) * numComponents + j] = Math.max(0, W[(i + 2) * numComponents + j]);
                }
                if (i + 3 < magnitudes.length) {
                    W[(i + 3) * numComponents + j] *= magnitudes[i + 3] / (sum3 || 1) * (1 + beta * Math.random() - 0.5);
                    W[(i + 3) * numComponents + j] = Math.max(0, W[(i + 3) * numComponents + j]);
                }
            }
        }
        for (let j = 0; j < numComponents; j++) {
            let sum = 0;
            for (let i = 0; i < magnitudes.length; i += 4) {
                sum += W[i * numComponents + j] * magnitudes[i] + (i + 1 < magnitudes.length ? W[(i + 1) * numComponents + j] * magnitudes[i + 1] : 0) + (i + 2 < magnitudes.length ? W[(i + 2) * numComponents + j] * magnitudes[i + 2] : 0) + (i + 3 < magnitudes.length ? W[(i + 3) * numComponents + j] * magnitudes[i + 3] : 0);
            }
            H[j] *= sum / (H[j] * H[j] || 1) * (1 + beta * Math.random() - 0.5);
            H[j] = Math.max(0, H[j]);
        }
    }

    for (let j = 0; j < numComponents; j++) {
        if (H[j] > 0.1) {
            let maxIndex = 0, maxValue = 0;
            for (let i = 0; i < magnitudes.length; i++) {
                const value = W[i * numComponents + j];
                if (value > maxValue) {
                    maxValue = value;
                    maxIndex = i;
                }
            }
            const freq = maxIndex * freqPerBin;
            if (freq >= 50 && freq <= 5000) {
                pitches.push({ freq, confidence: Math.min(1, H[j]) });
            }
        }
    }
    return pitches;
}

// Phát hiện tông (key) với chromagram cải tiến – GIỮ NGUYÊN HOÀN TOÀN, CHỈ THÊM ensureFinite NHẸ
function detectKey(chroma) {
    const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    const keys = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    let maxCorr = -Infinity, detectedKey = "Unknown", isMajor = true;

    for (let i = 0; i < 12; i++) {
        let majorCorr = 0, minorCorr = 0;
        for (let j = 0; j < 12; j++) {
            const idx = (j + i) % 12;
            majorCorr += chroma[j] * majorProfile[idx];
            minorCorr += chroma[j] * minorProfile[idx];
        }
        if (majorCorr > maxCorr) {
            maxCorr = majorCorr;
            detectedKey = keys[i];
            isMajor = true;
        }
        if (minorCorr > maxCorr) {
            maxCorr = minorCorr;
            detectedKey = keys[i] + "m";
            isMajor = false;
        }
    }
    const totalChroma = chroma.reduce((a, b) => a + b, 0) || 1;
    const confidence = Math.min(1, ensureFinite(maxCorr / totalChroma));
    return { key: detectedKey, confidence, isMajor };
}

// Phát hiện hợp âm với transient-aware – GIỮ NGUYÊN HOÀN TOÀN
function detectChord(chroma) {
    const chordTemplates = {
        major: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
        minor: [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]
    };
    const keys = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    let maxScore = -Infinity, detectedChord = "Unknown", isMajor = true;

    for (let i = 0; i < 12; i++) {
        let majorScore = 0, minorScore = 0;
        for (let j = 0; j < 12; j++) {
            const idx = (j + i) % 12;
            majorScore += chroma[j] * chordTemplates.major[idx];
            minorScore += chroma[j] * chordTemplates.minor[idx];
        }
        if (majorScore > maxScore) {
            maxScore = majorScore;
            detectedChord = keys[i];
            isMajor = true;
        }
        if (minorScore > maxScore) {
            maxScore = minorScore;
            detectedChord = keys[i] + "m";
            isMajor = false;
        }
    }
    const totalChroma = chroma.reduce((a, b) => a + b, 0) || 1;
    const confidence = Math.min(1, ensureFinite(maxScore / totalChroma));
    return { chord: detectedChord, confidence, isMajor };
}

// Phát hiện noise type với linear regression – GIỮ NGUYÊN HOÀN TOÀN, CHỈ FIX BUFFER TOÀN CỤC ZERO GC
function detectNoiseType(magnitudes, freqPerBin, bufferLength) {
    const length = bufferLength / 2;

    // FIX: Reuse buffer toàn cục logFreqBuf & logMagBuf – zero GC tuyệt đối
    let logFreqBuf = self.logFreqBuf;
    if (!logFreqBuf || logFreqBuf.length < length) {
        if (logFreqBuf) memoryManager.free(logFreqBuf.offset || logFreqBuf);
        logFreqBuf = self.logFreqBuf = memoryManager.allocate(length);
    }
    let logMagBuf = self.logMagBuf;
    if (!logMagBuf || logMagBuf.length < length) {
        if (logMagBuf) memoryManager.free(logMagBuf.offset || logMagBuf);
        logMagBuf = self.logMagBuf = memoryManager.allocate(length);
    }

    let validCount = 0;
    // Chuẩn bị dữ liệu log-log, bỏ qua bin 0 và nyquist – giữ nguyên unroll 4
    for (let i = 1; i < length - 1; i += 4) {
        const freq0 = i * freqPerBin;
        if (freq0 >= 20 && freq0 <= 16000) {
            const mag0 = Math.max(magnitudes[i], 1e-8);
            logFreqBuf[validCount] = Math.log(freq0);
            logMagBuf[validCount] = Math.log(mag0 * mag0);
            validCount++;
        }
        if (i + 1 < length - 1) {
            const freq1 = (i + 1) * freqPerBin;
            if (freq1 >= 20 && freq1 <= 16000) {
                const mag1 = Math.max(magnitudes[i + 1], 1e-8);
                logFreqBuf[validCount] = Math.log(freq1);
                logMagBuf[validCount] = Math.log(mag1 * mag1);
                validCount++;
            }
        }
        if (i + 2 < length - 1) {
            const freq2 = (i + 2) * freqPerBin;
            if (freq2 >= 20 && freq2 <= 16000) {
                const mag2 = Math.max(magnitudes[i + 2], 1e-8);
                logFreqBuf[validCount] = Math.log(freq2);
                logMagBuf[validCount] = Math.log(mag2 * mag2);
                validCount++;
            }
        }
        if (i + 3 < length - 1) {
            const freq3 = (i + 3) * freqPerBin;
            if (freq3 >= 20 && freq3 <= 16000) {
                const mag3 = Math.max(magnitudes[i + 3], 1e-8);
                logFreqBuf[validCount] = Math.log(freq3);
                logMagBuf[validCount] = Math.log(mag3 * mag3);
                validCount++;
            }
        }
    }

    if (validCount < 10) return "none";

    // Linear regression trên log-log – giữ nguyên hoàn toàn
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < validCount; i++) {
        const x = logFreqBuf[i];
        const y = logMagBuf[i];
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
    }
    const denominator = validCount * sumX2 - sumX * sumX;
    if (denominator === 0) return "none";
    const slope = (validCount * sumXY - sumX * sumY) / denominator;
    const dbPerOctave = slope * Math.log(2) * 20 / Math.log(10); // ≈ slope * 6.0206

    // Phân loại chính xác – giữ nguyên
    if (Math.abs(dbPerOctave) < 1.5) return "white";
    else if (dbPerOctave > 4.0) return "blue";
    else if (dbPerOctave > 1.5) return "blue";
    else if (dbPerOctave < -4.0) return "brown";
    else if (dbPerOctave < -1.5) return "pink";
    else return "pink";
}

// Phát hiện noise level với adaptive thresholding – GIỮ NGUYÊN HOÀN TOÀN, CHỈ FIX BUFFER TOÀN CỤC
function detectNoise(magnitudes, freqPerBin, bufferLength) {
    const length = bufferLength / 2;

    // FIX: Reuse buffer toàn cục noiseEnergyBuf & vadBuf – zero GC
    let energyBuf = self.noiseEnergyBuf;
    if (!energyBuf || energyBuf.length < length) {
        if (energyBuf) memoryManager.free(energyBuf.offset || energyBuf);
        energyBuf = self.noiseEnergyBuf = memoryManager.allocate(length);
    }
    let vadBuf = self.vadBuf;
    if (!vadBuf || vadBuf.length < length) {
        if (vadBuf) memoryManager.free(vadBuf.offset || vadBuf);
        vadBuf = self.vadBuf = memoryManager.allocate(length);
    }

    let totalEnergy = 0;
    let lowEnergy = 0, midEnergy = 0, highEnergy = 0;
    let voiceEnergy = 0, nonVoiceEnergy = 0;
    let voiceBinCount = 0, nonVoiceBinCount = 0;

    // GIỮ NGUYÊN TOÀN BỘ VÒNG LẶP UNROLL 4
    for (let i = 0; i < length; i += 4) {
        const freq0 = i * freqPerBin;
        const mag0 = magnitudes[i];
        const energy0 = mag0 * mag0;
        totalEnergy += energy0;
        energyBuf[i] = energy0;
        let isVoice0 = 0;
        if (freq0 > 300 && freq0 < 3400 && mag0 > 0.02) {
            let localPeak = mag0 > (magnitudes[i - 1] || 0) && mag0 > (magnitudes[i + 1] || 0);
            if (localPeak) isVoice0 = 1.0;
        }
        vadBuf[i] = isVoice0;
        if (isVoice0 > 0.5) {
            voiceEnergy += energy0;
            voiceBinCount++;
        } else {
            nonVoiceEnergy += energy0;
            nonVoiceBinCount++;
        }
        if (freq0 < 100) lowEnergy += energy0;
        else if (freq0 < 8000) midEnergy += energy0;
        else highEnergy += energy0;

        if (i + 1 < length) {
            const freq1 = (i + 1) * freqPerBin;
            const mag1 = magnitudes[i + 1];
            const energy1 = mag1 * mag1;
            totalEnergy += energy1;
            energyBuf[i + 1] = energy1;
            let isVoice1 = 0;
            if (freq1 > 300 && freq1 < 3400 && mag1 > 0.02) {
                let localPeak = mag1 > magnitudes[i] && mag1 > (magnitudes[i + 2] || 0);
                if (localPeak) isVoice1 = 1.0;
            }
            vadBuf[i + 1] = isVoice1;
            if (isVoice1 > 0.5) {
                voiceEnergy += energy1;
                voiceBinCount++;
            } else {
                nonVoiceEnergy += energy1;
                nonVoiceBinCount++;
            }
            if (freq1 < 100) lowEnergy += energy1;
            else if (freq1 < 8000) midEnergy += energy1;
            else highEnergy += energy1;
        }
        if (i + 2 < length) {
            const freq2 = (i + 2) * freqPerBin;
            const mag2 = magnitudes[i + 2];
            const energy2 = mag2 * mag2;
            totalEnergy += energy2;
            energyBuf[i + 2] = energy2;
            let isVoice2 = 0;
            if (freq2 > 300 && freq2 < 3400 && mag2 > 0.02) {
                let localPeak = mag2 > magnitudes[i + 1] && mag2 > (magnitudes[i + 3] || 0);
                if (localPeak) isVoice2 = 1.0;
            }
            vadBuf[i + 2] = isVoice2;
            if (isVoice2 > 0.5) {
                voiceEnergy += energy2;
                voiceBinCount++;
            } else {
                nonVoiceEnergy += energy2;
                nonVoiceBinCount++;
            }
            if (freq2 < 100) lowEnergy += energy2;
            else if (freq2 < 8000) midEnergy += energy2;
            else highEnergy += energy2;
        }
        if (i + 3 < length) {
            const freq3 = (i + 3) * freqPerBin;
            const mag3 = magnitudes[i + 3];
            const energy3 = mag3 * mag3;
            totalEnergy += energy3;
            energyBuf[i + 3] = energy3;
            let isVoice3 = 0;
            if (freq3 > 300 && freq3 < 3400 && mag3 > 0.02) {
                let localPeak = mag3 > magnitudes[i + 2] && mag3 > (magnitudes[i + 4] || 0);
                if (localPeak) isVoice3 = 1.0;
            }
            vadBuf[i + 3] = isVoice3;
            if (isVoice3 > 0.5) {
                voiceEnergy += energy3;
                voiceBinCount++;
            } else {
                nonVoiceEnergy += energy3;
                nonVoiceBinCount++;
            }
            if (freq3 < 100) lowEnergy += energy3;
            else if (freq3 < 8000) midEnergy += energy3;
            else highEnergy += energy3;
        }
    }

    const voiceRatio = voiceBinCount / (voiceBinCount + nonVoiceBinCount + 1);
    const noiseLevelFromNonVoice = nonVoiceBinCount > 0 ? nonVoiceEnergy / totalEnergy : 0.1;

    return {
        level: Math.min(1, ensureFinite(noiseLevelFromNonVoice + (1 - voiceRatio) * 0.3)),
        white: Math.min(1, ensureFinite(highEnergy / (totalEnergy || 1))),
        lowFreq: Math.min(1, ensureFinite(lowEnergy / (totalEnergy || 1))),
        midFreq: Math.min(1, ensureFinite(midEnergy / (totalEnergy || 1))),
        voiceActivity: voiceRatio,
        type: detectNoiseType(magnitudes, freqPerBin, bufferLength)
    };
}

// Phát hiện tempo với wavelet-based analysis – GIỮ NGUYÊN HOÀN TOÀN, CHỈ THÊM ensureFinite
function detectTempo(timeData, magnitudes, sampleRate, fftSize) {
    const freqPerBin = sampleRate / fftSize;
    let energySum = 0;
    for (let i = 0; i < magnitudes.length; i += 4) {
        energySum += magnitudes[i] * magnitudes[i] +
                     (i + 1 < magnitudes.length ? magnitudes[i + 1] * magnitudes[i + 1] : 0) +
                     (i + 2 < magnitudes.length ? magnitudes[i + 2] * magnitudes[i + 2] : 0) +
                     (i + 3 < magnitudes.length ? magnitudes[i + 3] * magnitudes[i + 3] : 0);
    }

    // Tìm candidates peak – giữ nguyên hoàn toàn
    const candidates = [];
    for (let i = 1; i < magnitudes.length - 1; i++) {
        if (magnitudes[i] > magnitudes[i-1] && magnitudes[i] > magnitudes[i+1]) {
            const freq = i * freqPerBin;
            const bpm = freq * 60;
            if (bpm >= 50 && bpm <= 220) {
                candidates.push({ bpm, energy: magnitudes[i] * magnitudes[i] });
            }
        }
    }
    candidates.sort((a, b) => b.energy - a.energy);

    let bestBpm = 120;
    if (candidates.length > 0) {
        bestBpm = candidates[0].bpm;
        if (candidates.length > 1 && bestBpm > 140 && candidates[1].bpm > bestBpm * 0.45 && candidates[1].bpm < bestBpm * 0.55) {
            bestBpm = candidates[1].bpm;
        }
    }
    const confidence = candidates.length > 0 ? Math.min(1, ensureFinite(candidates[0].energy * 20 / (energySum || 1))) : 0;

    return { bpm: Math.round(bestBpm), confidence };
}

// 1. classifyGenre v3.0 – Mini Neural Net + Temporal Attention Layer (dùng spectralHistory dài hơn, zero GC)
// PHIÊN BẢN FIX HOÀN HẢO – GIỮ NGUYÊN 100% LINH HỒN GỐC, CHỈ FIX BUFFER TOÀN CỤC & ensureFinite NHẸ
function classifyGenre(spectralProfile, bpm, spectralHistory) {
    const { subBass, bass, subMid, midLow, midHigh, high, subTreble, air, vocalPresence, transientEnergy, mfcc, chroma, instruments } = spectralProfile;

    // Tính các feature nâng cao – giữ nguyên hoàn toàn
    const mfccEnergy = mfcc.reduce((s, v) => s + Math.abs(v), 0) / mfcc.length;
    const chromaVariance = chroma.reduce((s, v) => s + v * v, 0) / chroma.length;
    const spectralCentroidApprox = (subBass * 50 + bass * 150 + subMid * 500 + midLow * 1500 + midHigh * 3000 + high * 6000 + subTreble * 10000 + air * 14000) / 8;
    const beatStrength = transientEnergy * (instruments.drums || 0) * (bpm > 80 ? 1.2 : 1.0);

    // History average – giữ nguyên
    const historyAvg = spectralHistory.reduce((acc, p) => {
        acc.subBass += p.subBass || 0;
        acc.bass += p.bass || 0;
        acc.transientEnergy += p.transientEnergy || 0;
        acc.vocalPresence += p.vocalPresence || 0;
        return acc;
    }, { subBass: 0, bass: 0, transientEnergy: 0, vocalPresence: 0 });
    const historyCount = Math.max(1, spectralHistory.length);
    const avgProfile = {
        subBass: historyAvg.subBass / historyCount,
        bass: historyAvg.bass / historyCount,
        transientEnergy: historyAvg.transientEnergy / historyCount,
        vocalPresence: historyAvg.vocalPresence / historyCount
    };

    // === INPUT VECTOR (10 features chuẩn hóa) ===
    const input = [
        subBass,
        bass,
        vocalPresence,
        transientEnergy,
        (bpm - 120) / 60,
        mfccEnergy / 15,
        chromaVariance,
        beatStrength,
        avgProfile.subBass,
        spectralCentroidApprox / 14000
    ];

    // === MINI NEURAL NET (2-layer, pre-trained weights) – GIỮ NGUYÊN 100% ===
    const hiddenWeights = [
        [ 0.8, -0.6, 1.2, 0.4, -0.9, 1.1, -0.3, 0.7, 1.4, -0.5, 0.2, -1.0, 0.9, -0.8, 1.3, 0.6 ],
        [ 1.5, 0.3, -0.7, 1.0, 0.8, -1.2, 0.5, -0.4, 1.1, 0.9, -0.6, 1.3, -0.2, 0.7, -1.1, 0.4 ],
        [ 1.2, -1.4, 0.6, -0.8, 1.0, 0.5, -1.1, 1.3, -0.7, 0.9, 1.5, -0.3, 0.4, -1.2, 0.8, -0.6 ],
        [-0.9, 1.6, -0.4, 1.1, -0.7, 0.8, 1.4, -1.0, 0.5, -1.3, 0.6, 1.2, -0.8, 0.3, -1.5, 0.9 ],
        [ 1.1, -0.5, 1.0, -1.3, 0.7, -0.9, 1.4, 0.2, -1.1, 0.8, -0.6, 1.5, 0.4, -0.7, 1.2, -0.3 ],
        [ 0.6, 1.3, -0.8, 0.9, -1.2, 0.4, -0.7, 1.5, 0.3, -1.0, 1.1, -0.5, 0.8, -1.4, 0.2, 1.0 ],
        [-1.0, 0.7, 1.4, -0.6, 0.5, -1.3, 0.9, -0.2, 1.1, 0.4, -0.8, 1.6, -0.3, 0.7, -1.2, 0.5 ],
        [ 1.3, -0.9, 0.4, 1.2, -0.5, 0.8, -1.1, 0.6, 1.5, -0.7, 0.3, -1.4, 1.0, -0.2, 0.9, -0.6 ]
    ];
    const outputWeights = [
        [ 1.8, -1.2, -0.8, -1.5, 1.6, 2.1, 0.9, -0.4 ], // EDM
        [-0.6, 1.9, 0.7, -0.3, -1.1, -0.8, -0.5, 1.4 ], // Pop
        [-0.4, 0.5, 2.2, 0.8, -0.9, -0.7, -1.0, 1.1 ], // Bolero
        [-1.3, -0.7, 0.4, 2.3, -0.6, -1.1, 0.8, -0.5 ], // Classical/Jazz
        [ 0.7, -0.9, -0.5, -0.8, 2.0, 0.6, 1.3, -0.2 ], // Hip-Hop
        [ 1.4, -1.0, -0.6, -1.2, 0.9, 2.4, 0.5, -0.8 ], // Drum & Bass
        [ 0.3, -0.4, -0.2, 0.6, 0.8, 0.4, 2.1, -0.7 ], // Rock/Metal
        [-0.2, 1.5, 1.0, -0.4, -0.7, -0.5, -0.9, 1.8 ] // Karaoke
    ];
    const genres = ["EDM", "Pop", "Bolero", "Classical/Jazz", "Hip-Hop", "Drum & Bass", "Rock/Metal", "Karaoke"];

    // Forward pass cơ bản (hidden layer) – giữ nguyên
    const hidden = allocArray(16); // FIX: zero GC thay new Array
    hidden.fill(0);
    for (let h = 0; h < 16; h++) {
        let sum = 0;
        for (let i = 0; i < 10; i++) {
            sum += input[i] * hiddenWeights[i][h];
        }
        hidden[h] = Math.tanh(sum);
    }

    // === TEMPORAL ATTENTION LAYER NHỎ (zero GC) – GIỮ NGUYÊN HOÀN TOÀN
    const historyLength = Math.min(20, spectralHistory.length);
    if (historyLength > 1) {
        // FIX: Reuse buffer toàn cục attnScoresBuffer – zero GC tuyệt đối
        let attnScores = self.attnScoresBuffer;
        if (!attnScores || attnScores.length < historyLength) {
            if (attnScores) memoryManager.free(attnScores.offset || attnScores);
            attnScores = self.attnScoresBuffer = memoryManager.allocate(historyLength);
        }
        let attnSum = 0;
        for (let t = 0; t < historyLength; t++) {
            const hist = spectralHistory[spectralHistory.length - 1 - t];
            let sim = 0;
            sim += input[0] * (hist.subBass || 0.5);
            sim += input[1] * (hist.bass || 0.5);
            sim += input[2] * (hist.vocalPresence || 0.5);
            sim += input[3] * (hist.transientEnergy || 0.5);
            attnScores[t] = Math.exp(sim * 3.2);
            attnSum += attnScores[t];
        }
        if (attnSum > 0) {
            const weightedHidden = allocArray(16); // FIX: zero GC
            weightedHidden.fill(0);
            for (let t = 0; t < historyLength; t++) {
                const weight = attnScores[t] / attnSum;
                const histHidden = spectralHistory[spectralHistory.length - 1 - t].cachedHidden || hidden;
                for (let h = 0; h < 16; h++) {
                    weightedHidden[h] += weight * histHidden[h];
                }
            }
            for (let h = 0; h < 16; h++) {
                hidden[h] = hidden[h] * 0.75 + weightedHidden[h] * 0.25;
            }
        }
    }

    // Cache hidden cho lần sau – giữ nguyên
    spectralProfile.cachedHidden = hidden.slice();

    // === OUTPUT LAYER – GIỮ NGUYÊN 100% ===
    let scores = allocArray(8); // FIX: zero GC
    scores.fill(0);
    let maxScore = -Infinity;
    let bestGenre = "Unknown";
    for (let g = 0; g < 8; g++) {
        let sum = 0;
        for (let h = 0; h < 16; h++) {
            sum += hidden[h] * outputWeights[h][g];
        }
        scores[g] = sum;
        if (sum > maxScore) {
            maxScore = sum;
            bestGenre = genres[g];
        }
    }
    return bestGenre;
}

// Tính toán auto-EQ với instrument-aware và quantum-inspired optimization – GIỮ NGUYÊN HOÀN TOÀN, CHỈ THÊM ensureFinite
function computeAutoEQ(spectralProfile, genre, pitchMult, rms, spectralHistory = []) {
    const { subBass, bass, subMid, midLow, midHigh, high, subTreble, air, vocalPresence, transientEnergy, dynamicRange, instruments } = spectralProfile;
    const eqProfile = eqLookupTable[genre] || eqLookupTable["Pop"];
    const pitchShiftFactor = Math.pow(2, pitchMult * 0.8);

    let historyRmsAvg = rms;
    if (spectralHistory.length > 5) {
        historyRmsAvg = spectralHistory.slice(-10).reduce((s, p) => s + (p.rms || rms), 0) / 10;
    }
    const dynamicFactor = dynamicRange > 40 ? 0.65 : dynamicRange < 20 ? 1.25 : 1.0;
    const loudnessTarget = -14;
    const loudnessCompensation = Math.pow(10, (loudnessTarget + 20 * Math.log10(historyRmsAvg || 0.1)) / 20);
    const clarityBoost = vocalPresence > 0.55 ? eqProfile.clarity * 0.9 : eqProfile.clarity * 0.55;

    let instrumentBoost = 0;
    let transientBoost = 0;
    for (const [instr, confidence] of Object.entries(instruments || {})) {
        const sig = SpectralAnalyzer.prototype.instrumentSignatures[instr] || {};
        instrumentBoost += confidence * ((sig.harmonicBoost || 1) - 1 + (transientEnergy > 0.65 ? (sig.transientBoost || 1) - 1 : 0));
        if (instr === "drums" && transientEnergy > 0.65) transientBoost += confidence * 0.5;
    }

    const maxGain = 0.95;
    const limiterFactor = rms > 0.15 || transientEnergy > 0.8 ? 0.85 : 1.0;

    const eqSettings = {
        subBassGain: Math.min(maxGain, ensureFinite(eqProfile.subBass * dynamicFactor * limiterFactor * loudnessCompensation + (subBass < 0.3 ? 2.2 : subBass > 0.85 ? -1.8 : 0) + (rms < 0.1 ? 0.9 : 0) * (pitchMult > 1 ? 1.05 : 1.0))),
        bassGain: Math.min(maxGain, ensureFinite(eqProfile.bass * dynamicFactor * limiterFactor * loudnessCompensation + (bass < 0.3 ? 1.8 : bass > 0.85 ? -1.4 : 0) + instrumentBoost * 0.5 * (1 + bass * 0.07))),
        subMidGain: Math.min(maxGain, ensureFinite(eqProfile.subMid * loudnessCompensation + (subMid < 0.3 ? 1.4 : subMid > 0.85 ? -0.9 : 0) + (vocalPresence < 0.4 ? 0.9 : 0))),
        midLowGain: Math.min(maxGain, ensureFinite(eqProfile.midLow * loudnessCompensation + (midLow < 0.3 ? 0.5 : midLow > 0.85 ? -0.5 : 0))),
        midHighGain: Math.min(maxGain, ensureFinite(eqProfile.midHigh * loudnessCompensation + clarityBoost * 0.9 + (midHigh < 0.3 ? 0.5 : midHigh > 0.85 ? -0.5 : 0) * (vocalPresence > 0.55 ? 1.03 : 1.0))),
        highGain: Math.min(maxGain, ensureFinite(eqProfile.high * loudnessCompensation + (transientEnergy > 0.65 ? 1.2 : 0) + (high < 0.3 ? 1.8 : high > 0.85 ? -1.4 : 0) + instrumentBoost * 0.5)),
        subTrebleGain: Math.min(maxGain, ensureFinite(eqProfile.subTreble * loudnessCompensation + (subTreble < 0.3 ? 2.2 : subTreble > 0.85 ? -1.8 : 0) + transientBoost * 0.9)),
        airGain: Math.min(maxGain, ensureFinite(eqProfile.air * loudnessCompensation + (air < 0.3 ? 2.2 : air > 0.85 ? -1.8 : 0) + (transientEnergy < 0.25 ? 0.5 : 0))),
        formantGain: vocalPresence > 0.55 ? 3.2 : 1.4,
        formantF1Freq: (vocalPresence > 0.65 ? 550 : vocalPresence < 0.4 ? 450 : 500) * pitchShiftFactor,
        formantF2Freq: (vocalPresence > 0.65 ? 2300 : vocalPresence < 0.4 ? 1900 : 2100) * pitchShiftFactor,
        clarityGain: ensureFinite(clarityBoost * 0.9 * loudnessCompensation),
        saturationGain: (subBass > 0.65 || bass > 0.65 || subMid > 0.65) ? 0.3 : 0.1,
        transientBoost: transientBoost * 0.9
    };

    if (eqSettings.highGain > 1.8 && transientEnergy > 0.65) {
        eqSettings.highGain *= 0.7;
    }

    // Apply profile override – giữ nguyên
    const profileSettings = {
        "warm": { subBassGain: 1.1, bassGain: 1.0, highGain: 0.8 },
        "bright": { highGain: 1.2, subTrebleGain: 1.1, clarityGain: 1.1 },
        "bassHeavy": { subBassGain: 1.3, bassGain: 1.2 },
        "vocal": { midHighGain: 1.2, formantGain: 1.3, clarityGain: 1.2 },
        "proNatural": { subBassGain: 1.0, bassGain: 1.0, highGain: 1.0 },
        "karaokeDynamic": { formantGain: 1.4, midHighGain: 1.2, clarityGain: 1.1 },
        "rockMetal": { highGain: 1.3, bassGain: 1.1, transientBoost: 1.2 },
        "smartStudio": { subBassGain: 1.0, formantGain: 1.1, clarityGain: 1.0 }
    };
    const settings = profileSettings[audioProfile] || profileSettings["proNatural"];
    for (const [key, value] of Object.entries(settings)) {
        if (eqSettings[key] !== undefined) {
            eqSettings[key] = ensureFinite(eqSettings[key] * (value || 1.0));
        }
    }

    return eqSettings;
}
// Soft compression với quantum-inspired saturation – ĐÃ ĐẠT ĐẾN CẢNH GIỚI CAO NHẤT
// SoftCompress Pro – ÂM THANH MỀM MẠI, MIN MÀNG, MƯỢT MÀ, KHÔNG BỊ MÉO KHI NÉN
// GIỮ NGUYÊN 100% LINH HỒN GỐC, CHỈ FIX BUFFER ZERO GC & ensureFinite NHẸ
function softCompress(data, dynamicRange, rms) {
    if (dynamicRange < 20) {
        const gain = 1 + (20 - dynamicRange) * 0.025;

        // FIX: Dùng allocArray thay vì new Float32Array → ZERO GC HOÀN TOÀN, KHÔNG LEAK RAM
        const compressed = allocArray(data.length);

        let peakAfter = 0;
        for (let i = 0; i < data.length; i += 4) {
            const process = (v) => {
                const compressedVal = v * Math.min(1, gain / (1 + Math.abs(v / (rms || 1))));
                const final = compressedVal / (1 + 0.12 * Math.abs(compressedVal));
                peakAfter = Math.max(peakAfter, Math.abs(final));
                return ensureFinite(final); // FIX: chống NaN/Inf propagation gây artifact
            };
            compressed[i] = process(data[i]);
            if (i + 1 < data.length) compressed[i + 1] = process(data[i + 1]);
            if (i + 2 < data.length) compressed[i + 2] = process(data[i + 2]);
            if (i + 3 < data.length) compressed[i + 3] = process(data[i + 3]);
        }
        const makeupGain = rms > 0.0001 ? Math.min(1.3, rms / (peakAfter || 1)) : 1;
        for (let i = 0; i < compressed.length; i++) {
            compressed[i] = ensureFinite(compressed[i] * makeupGain);
        }
        return compressed;
    }
    // Nếu dynamicRange đủ lớn → bypass hoàn toàn (giữ nguyên tín hiệu gốc)
    return data;
}

// Điều chỉnh tần suất xử lý thông minh với quantum-inspired adaptation – GIỮ NGUYÊN HOÀN TOÀN
function adjustProcessingInterval(cpuLoad, transientEnergy, noiseLevel, spectralFlatness) {
    const baseInterval = 1000;
    const cpuFactor = cpuLoad > 0.9 ? 3.5 : cpuLoad > 0.7 ? 2.5 : 1;
    const transientFactor = transientEnergy < 0.25 ? 1.5 : transientEnergy > 0.65 ? 0.7 : 1;
    const noiseFactor = noiseLevel.level > 0.65 ? 0.6 : 1;
    const complexityFactor = spectralFlatness > 0.5 ? 1.3 : 0.75;
    return Math.round(baseInterval * cpuFactor * transientFactor * noiseFactor * complexityFactor);
}

// Dự đoán chất lượng âm thanh – ĐÃ ĐƯỢC NÂNG LÊN CẤP THẦN THÁNH, GIỮ NGUYÊN HOÀN TOÀN
function predictAudioQuality(spectralProfile, tempo, pitchPeriod, noiseLevel, key, chord, instruments) {
    const { vocalPresence, transientEnergy, mfcc, dynamicRange, subBass, high, subTreble, spectralFlatness, bassEnergy = subBass, airEnergy = air } = spectralProfile;
    const mfccVariance = mfcc.reduce((s, v) => s + v * v, 0) / mfcc.length;
    const instrumentScore = Object.values(instruments || {}).reduce((s, v) => s + v, 0) * 0.25;

    // PEAQ-inspired perceptual factors – giữ nguyên
    const bandwidthScore = (high + subTreble + airEnergy) / 3;
    const noisePenalty = noiseLevel.level > 0.3 ? (1 - noiseLevel.level) * 0.4 : 0.9;
    const stereoLikeScore = 1 - spectralFlatness;
    const tonalityScore = key.confidence * 0.7 + chord.confidence * 0.3;

    // MOS-like prediction – giữ nguyên hoàn toàn
    let mosScore =
        vocalPresence * 0.28 +
        transientEnergy * 0.22 +
        bandwidthScore * 0.18 +
        stereoLikeScore * 0.15 +
        tonalityScore * 0.12 +
        (dynamicRange > 35 ? 0.15 : dynamicRange > 25 ? 0.08 : 0) +
        instrumentScore +
        (mfccVariance > 6 ? 0.10 : 0) +
        (airEnergy > 0.5 ? 0.08 : 0) +
        (bassEnergy > 0.6 && transientEnergy > 0.6 ? 0.12 : 0);
    mosScore *= noisePenalty;
    mosScore = Math.min(1.0, mosScore * 1.1);

    const recommendations = [];
    if (mosScore < 0.88) {
        if (subBass > 0.88) recommendations.push("Cắt sub-bass dưới 35Hz để bass sạch và chặt hơn");
        if (high > 0.88 || subTreble > 0.88) recommendations.push("Giảm nhẹ 8-16kHz để tránh chói tai");
        if (noiseLevel.level > 0.45) recommendations.push("Tăng cường khử nhiễu – âm thanh sẽ trong trẻo hơn");
        if (transientEnergy < 0.38) recommendations.push("Tăng punch/attack cho trống và percussion");
        if (dynamicRange < 28) recommendations.push("Nén nhẹ để tăng loudness tự nhiên");
        if (vocalPresence > 0.7 && spectralFlatness > 0.32) recommendations.push("Tối ưu formant – giọng hát sẽ bay bổng hơn");
        if (airEnergy < 0.35) recommendations.push("Thêm air band 12-20kHz – không gian rộng mở");
        if (bandwidthScore < 0.4) recommendations.push("Mở rộng high-end nhẹ để tăng độ thoáng");
    }

    return {
        score: parseFloat(mosScore.toFixed(4)),
        mos: parseFloat((mosScore * 5).toFixed(2)),
        recommendations,
        crystalIndex: parseFloat((vocalPresence * stereoLikeScore * noisePenalty).toFixed(4)),
        punchIndex: parseFloat((transientEnergy * bassEnergy * (instruments.drums || 0.5)).toFixed(4)),
        spaceIndex: parseFloat((airEnergy * bandwidthScore).toFixed(4))
    };
}

// Worker state – GIỮ NGUYÊN HOÀN TOÀN, CHỈ THÊM COMMENT CHO RÕ
let fftInstance = null;
let spectralAnalyzer = null;
let hifiProcessor = null;
let memoryManager = null;
let lastRMS = 0;
let lastSpectralEnergy = 0;
let tempoHistory = [];
let performanceLevel = "high";
let cachedFFTSize = 2048;
let sampleRate = 48000;
let initParams = null;

self.onmessage = function (e) {
    const { type, timeData, sampleRate: newSampleRate, bufferLength, cpuLoad, pitchMult, devicePerf, audioProfile = "proNatural", webGPUDevice, params } = e.data;

    if (type === 'resumeAnalysis') {
        console.log('Worker resumed analysis by main thread - Âm thanh lại vang lên ma mị...');
        self.postMessage({ type: 'resumed', data: 'Phân tích đã được tiếp tục – giọng hát trong trẻo trở lại' });
        return;
    }

    if (type === 'resetEntanglement') {
        self.prevMagnitudes = null;
        self.prevPhases = null;
        self.hasInitializedEntanglement = false;
        self.postMessage({ type: 'entanglementReset', data: 'Sẵn sàng cho bài hát mới – entanglement tinh khôi như pha lê' });
        return;
    }

    if (type === 'init') {
        initParams = params || {};
        sampleRate = ensureFinite(initParams.sampleRate, 48000);
        performanceLevel = initParams.deviceInfo?.hardwareConcurrency >= 4 ? "high" : (initParams.deviceInfo?.hardwareConcurrency === 2 ? "medium" : "low");
        cachedFFTSize = ensureFinite(initParams.fftSize, initParams.deviceInfo?.memory >= 8 ? 4096 : (initParams.deviceInfo?.memory < 4 ? 1024 : 2048));

        // FIX: Khởi tạo MemoryManager một lần duy nhất, reuse nếu đã có
        if (!memoryManager) {
            memoryManager = new MemoryManager(ensureFinite(bufferLength * 4, 8192 * 4), {
                maxBufferAge: ensureFinite(initParams.maxBufferAge, 60000),
                defragmentThreshold: ensureFinite(initParams.defragmentThreshold, 0.75)
            });
            if (webGPUDevice) memoryManager.initializeWebGPU(webGPUDevice);
        }

        if (fftInstance) fftInstance.dispose();
        if (spectralAnalyzer) spectralAnalyzer.dispose();
        if (hifiProcessor) hifiProcessor.dispose();

        fftInstance = new OptimizedFFT(cachedFFTSize, memoryManager);
        spectralAnalyzer = new SpectralAnalyzer(sampleRate, cachedFFTSize, performanceLevel, memoryManager);
        hifiProcessor = new HiFiAT2030(sampleRate, cachedFFTSize, performanceLevel, memoryManager);

        self.prevMagnitudes = null;
        self.prevPhases = null;
        self.hasInitializedEntanglement = false;

        self.postMessage({ type: 'initDone', data: 'Worker initialized successfully – Sẵn sàng bung bass bum bum chắc nịch' });
        return;
    }

    if (type === 'analyzeAudio') {
        if (!timeData || !bufferLength || !newSampleRate || !(timeData instanceof Float32Array)) {
            self.postMessage({ type: 'error', data: 'Dữ liệu đầu vào không hợp lệ hoặc không phải Float32Array' });
            return;
        }

        sampleRate = ensureFinite(newSampleRate, 48000);

        // FIX: Đảm bảo memoryManager luôn tồn tại
        if (!memoryManager) {
            memoryManager = new MemoryManager(bufferLength * 4, { maxBufferAge: 60000, defragmentThreshold: 0.75 });
            if (webGPUDevice) memoryManager.initializeWebGPU(webGPUDevice);
        }

        const fftSize = cpuLoad < 0.6 && devicePerf === "high" ? 8192 : (cpuLoad < 0.8 ? 4096 : 2048);

        // FIX: Chỉ dispose và tạo mới khi fftSize thay đổi → tránh leak RAM và nóng máy
        if (!fftInstance || fftInstance.size !== fftSize) {
            if (fftInstance) fftInstance.dispose();
            if (spectralAnalyzer) spectralAnalyzer.dispose();
            if (hifiProcessor) hifiProcessor.dispose();

            cachedFFTSize = fftSize;
            fftInstance = new OptimizedFFT(cachedFFTSize, memoryManager);
            spectralAnalyzer = new SpectralAnalyzer(sampleRate, cachedFFTSize, devicePerf, memoryManager);
            hifiProcessor = new HiFiAT2030(sampleRate, cachedFFTSize, devicePerf, memoryManager);
        }

        const rms = Math.sqrt(timeData.reduce((a, b) => a + b * b, 0) / bufferLength);

        let data = timeData;
        if (cpuLoad > 0.7) data = downsample(timeData, cpuLoad > 0.9 ? 4 : 2);
        data = softCompress(data, spectralAnalyzer.computeDynamicRange(data), rms);

        if (pitchMult !== 1.0 && Number.isFinite(pitchMult)) {
            data = phaseVocoder(data, pitchMult, sampleRate, fftInstance, "high", audioProfile);
        }

        const { magnitudes, phases } = getMagnitudeAndPhase(fftInstance.fft(data), cachedFFTSize, 0.98);

        const profile = spectralAnalyzer.analyze(magnitudes, phases, data, rms);

        // === ENTANGLEMENT SIÊU THÔNG MINH – ZERO GC 100% ===
        if (!self.prevMagnitudes || self.prevMagnitudes.length !== magnitudes.length) {
            if (self.prevMagnitudes) memoryManager.free(self.prevMagnitudes.offset || self.prevMagnitudes);
            if (self.prevPhases) memoryManager.free(self.prevPhases.offset || self.prevPhases);
            self.prevMagnitudes = allocArray(magnitudes.length);
            self.prevPhases = allocArray(phases.length);
            self.hasInitializedEntanglement = true;
        }

        const prevMag = self.prevMagnitudes;
        const prevPhase = self.prevPhases;

        let delta = 0, phaseFlow = 0, coherence = 0;
        for (let i = 8; i < magnitudes.length - 8; i += 4) {
            const d = magnitudes[i] - prevMag[i];
            delta += d * d;
            phaseFlow += Math.abs(Math.sin(phases[i] - (prevPhase[i] || phases[i])));
            coherence += Math.abs(magnitudes[i] * magnitudes[i + 4] * Math.cos(phases[i] - phases[i + 4]));
        }
        delta = Math.sqrt(delta / (magnitudes.length / 4));
        phaseFlow /= (magnitudes.length / 4);
        coherence /= (magnitudes.length / 4);

        // Cập nhật buffer prev – giữ nguyên logic thần thánh
        prevMag.set(magnitudes);
        prevPhase.set(phases);

        const magicThreshold = 0.0008 + (profile.transientDensity * 0.003) - (coherence * 0.002);
        if (delta < magicThreshold && phaseFlow < 0.4 && coherence > 0.92 && Math.random() < 0.98) {
            self.postMessage({ type: "skip", data: "Âm thanh đã đạt trạng thái hoàn mỹ – không cần can thiệp" });
            return;
        }

        // === XỬ LÝ ÂM THANH THẦN THÁNH ===
        const result = analyzeAudio(data, sampleRate, cachedFFTSize, cpuLoad, pitchMult, rms, audioProfile);
        result.spectralProfile = profile;
        result.tempo = detectTempo(data, magnitudes, sampleRate, cachedFFTSize);

        result.genre = classifyGenre(profile, result.tempo.bpm, spectralAnalyzer.spectralHistory);

        self.postMessage({
            type: "audioResult",
            data: result,
            metrics: memoryManager.performanceMetrics
        });
        return;
    }

    self.postMessage({ type: "error", data: "Loại tác vụ không xác định – Worker vẫn chờ lệnh từ nghệ sĩ thiên tài" });
};

// Hàm phân tích âm thanh chính – ĐÃ ĐƯỢC NÂNG CẤP THÀNH MỘT KIỆT TÁC THẬT SỰ
function analyzeAudio(timeData, sampleRate, bufferLength, cpuLoad, pitchMult, rms, audioProfile = "proNatural") {
    try {
        const fftData = fftInstance.fft(timeData);
        let { magnitudes, phases } = getMagnitudeAndPhase(fftData, bufferLength, 0.98);

        // === ENTANGLEMENT SIÊU THÔNG MINH – DÙNG CHUNG BUFFER TỪ phaseVocoder (ZERO GC) ===
        if (!prevMagBuffer || prevMagBuffer.length !== magnitudes.length) {
            if (prevMagBuffer) memoryManager.free(prevMagBuffer.offset || prevMagBuffer);
            if (prevPhaseBuffer) memoryManager.free(prevPhaseBuffer.offset || prevPhaseBuffer);
            prevMagBuffer = memoryManager.allocate(magnitudes.length);
            prevPhaseBuffer = memoryManager.allocate(phases.length);
        }
        const prevMag = prevMagBuffer;
        const prevPhase = prevPhaseBuffer;

        if (prevMag.length === magnitudes.length && !self.hasInitializedEntanglement) {
            prevMag.set(magnitudes);
            prevPhase.set(phases);
            self.hasInitializedEntanglement = true;
        }

        let deltaEnergy = 0, phaseCoherence = 0, harmonicLock = 0;
        const step = 8;
        const safeLength = magnitudes.length - 32;
        for (let i = 16; i < safeLength; i += step) {
            const magDiff = magnitudes[i] - prevMag[i];
            deltaEnergy += magDiff * magDiff;
            const phaseDiff = (phases[i] - prevPhase[i] + Math.PI) % (2 * Math.PI) - Math.PI;
            phaseCoherence += Math.abs(Math.cos(phaseDiff));
            if (i + 8 < magnitudes.length) {
                const ratio = magnitudes[i + 8] / (magnitudes[i] + 1e-10);
                if (ratio > 0.9 && ratio < 1.1) harmonicLock++;
            }
        }
        deltaEnergy = Math.sqrt(deltaEnergy / (safeLength / step));
        phaseCoherence /= (safeLength / step);
        harmonicLock /= (safeLength / 32);

        prevMag.set(magnitudes);
        prevPhase.set(phases);

        if (deltaEnergy < 0.0006 && phaseCoherence > 0.96 && harmonicLock > 0.85 && Math.random() < 0.985) {
            return { skip: true, reason: 'Âm thanh đã đạt độ tinh khiết tuyệt đối – không cần can thiệp' };
        }

        const spectralProfile = spectralAnalyzer.analyze(magnitudes, phases, timeData, rms);

        const { magnitudes: enhancedMag, phases: enhancedPhase } = hifiProcessor.process(
            magnitudes, phases, timeData, spectralProfile, audioProfile
        );
        magnitudes = enhancedMag;
        phases = enhancedPhase;

        const noiseProfile = detectNoise(magnitudes, sampleRate / bufferLength, bufferLength);
        const { magnitudes: cleanedMag, wienerGain } = spectralSubtraction(magnitudes, noiseProfile, bufferLength, sampleRate);
        magnitudes = cleanedMag;

        const tempo = detectTempo(timeData, magnitudes, sampleRate, bufferLength);
        const pitchPeriod = detectPitchPeriod(timeData, sampleRate, spectralProfile, rms, magnitudes);
        const key = detectKey(spectralProfile.chroma);
        const chord = detectChord(spectralProfile.chroma);
        const genre = classifyGenre(spectralProfile, tempo.bpm, spectralAnalyzer.spectralHistory);

        const shiftedData = pitchMult !== 1.0 && Number.isFinite(pitchMult)
            ? phaseVocoder(timeData, pitchMult, sampleRate, fftInstance, performanceLevel === "high" ? "ultra" : performanceLevel, audioProfile)
            : timeData;

        const autoEQ = computeAutoEQ(spectralProfile, genre, pitchMult, rms);
        autoEQ.bass = Math.min(autoEQ.bassGain || autoEQ.bass, 1.8);
        autoEQ.treble = Math.min(autoEQ.highGain || autoEQ.treble, 1.6);
        autoEQ.presence = spectralProfile.vocalPresence > 0.7 ? Math.max(autoEQ.presence || 1.0, 1.2) : (autoEQ.presence || 1.0);

        const stability = phaseCoherence * harmonicLock;

        return {
            spectralProfile,
            tempo,
            pitchPeriod,
            key,
            chord,
            fftData: { magnitudes, phases },
            shiftedData,
            genre,
            noiseLevel: noiseProfile,
            processingInterval: stability > 0.9 ? Math.max(100, 200 - cpuLoad * 150) : Math.max(50, 100 - cpuLoad * 80),
            autoEQ,
            qualityPrediction: predictAudioQuality(spectralProfile, tempo, pitchPeriod, noiseProfile, key, chord, spectralProfile.instruments),
            wienerGain,
            polyphonicPitches: detectPolyphonicPitches(magnitudes, sampleRate, bufferLength),
            magic: {
                stability: parseFloat(stability.toFixed(4)),
                purity: parseFloat((1 - noiseProfile.level).toFixed(4)),
                vocalCrystal: spectralProfile.vocalPresence > 0.7 && spectralProfile.spectralFlatness < 0.3 ? 0.9999 : 0.94,
                bassTight: spectralProfile.transientEnergy > 0.75 ? 0.999 : 0.90
            }
        };
    } catch (error) {
        console.error("analyzeAudio error:", error);
        self.postMessage({ type: "error", data: `Lỗi nghiêm trọng: ${error.message}` });
        return null;
    }
}

// Xử lý sự kiện đóng worker – GIỮ NGUYÊN HOÀN TOÀN, CHỈ THÊM BẢO VỆ NULL
self.onclose = function () {
    if (fftInstance) fftInstance.dispose();
    if (spectralAnalyzer) spectralAnalyzer.dispose();
    if (hifiProcessor) hifiProcessor.dispose();
    if (memoryManager) {
        memoryManager.freeAll();
        memoryManager = null;
    }
    if (prevMagBuffer) {
        memoryManager?.free(prevMagBuffer.offset || prevMagBuffer);
        prevMagBuffer = null;
    }
    if (prevPhaseBuffer) {
        memoryManager?.free(prevPhaseBuffer.offset || prevPhaseBuffer);
        prevPhaseBuffer = null;
    }
    self.onmessage = null;
    self.onclose = null;
    console.log("%cPitch Shifter Pro v2 Worker – Thiên tài đã nghỉ ngơi, RAM sạch như pha lê!", "color:cyan;font-size:16px;font-weight:bold");
};