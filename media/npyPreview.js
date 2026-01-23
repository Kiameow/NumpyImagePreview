(function() {
    console.log("Webview script initializing...");
    const vscode = acquireVsCodeApi();

    // Global State
    const previousState = vscode.getState() || {};
    let globalArrayData = null;
    let currentLayout = previousState.layout || ''; 
    let currentBatchIndex = previousState.batchIndex || 0;
    let currentDisplayMode = previousState.displayMode || 'auto'; // 'auto', 'rgb', 'gray'
    let currentChannelStart = previousState.channelStart || 0;

    // Always send ready message, but handle potential race conditions
    function sendMessage(type, info=null) {
        vscode.postMessage({ type: type, info: info });
    }

    // If document is already loaded, send ready immediately
    if (document.readyState === 'complete') {
        sendMessage('ready');
    } else {
        // Otherwise, wait for document to load
        window.addEventListener('load', sendMessage('ready'));
    }

    window.addEventListener('message', event => {
        console.log("Message received:", event.data);
        
        const message = event.data;
        
        switch (message.type) {
            case 'arrayData':
                globalArrayData = message.data;
                const shape = globalArrayData.shape;
                const rank = shape.length;
                const supportedLayouts = getSupportedLayouts(rank);

                // --- PRIORITY LOGIC START ---
                
                // 1. Check Local State (User explicitly set this before)
                // We assume previousState.layout exists ONLY if user clicked it previously
                if (previousState && previousState.layout) {
                    currentLayout = previousState.layout;
                    // Restore other states if they exist
                    if (previousState.batchIndex !== undefined) {currentBatchIndex = previousState.batchIndex;}
                    if (previousState.displayMode) {currentDisplayMode = previousState.displayMode;}
                    if (previousState.channelStart !== undefined) {currentChannelStart = previousState.channelStart;}
                } 
                
                // 2. Check Global Preference (Only if valid for this specific file shape)
                else if (message.preferredLayout && supportedLayouts.includes(message.preferredLayout)) {
                    currentLayout = message.preferredLayout;
                    // Reset other states to defaults since this is effectively a "fresh" load
                    currentBatchIndex = 0;
                    currentChannelStart = 0;
                } 
                
                // 3. Fallback to Guess
                else {
                    currentLayout = guessLayout(shape) || supportedLayouts[0];
                    currentBatchIndex = 0;
                    currentChannelStart = 0;
                }
                
                // --- PRIORITY LOGIC END ---

                initViewer(globalArrayData);
                break;
            case 'error':
                displayError(message.message);
                break;
        }
    });
    
    // Layout logic
    // Calculate memory strides (step sizes) for each dimension
    // e.g., shape=[2, 3, 4] -> strides=[12, 4, 1]
    function getOriginalStrides(shape) {
        const strides = new Array(shape.length);
        let s = 1;
        for (let i = shape.length - 1; i >= 0; i--) {
            strides[i] = s;
            s *= shape[i];
        }
        return strides;
    }

    // Map semantic keys (B, H, W, C) to their step sizes in the flat array
    function calculateSemanticStrides(shape, layout) {
        const rawStrides = getOriginalStrides(shape);
        const map = {
            'B': 0, 'H': 0, 'W': 0, 'C': 0
        };
        
        // Map layout chars to raw strides
        // e.g., layout='CHW', shape=[3,100,100]
        // rawStrides=[10000, 100, 1]
        // map['C'] = 10000, map['H'] = 100, map['W'] = 1
        for (let i = 0; i < layout.length; i++) {
            const char = layout[i];
            map[char] = rawStrides[i];
        }
        return map;
    }

    // Generate valid layout options based on dimensions (Rank)
    function getSupportedLayouts(rank) {
        switch(rank) {
            case 2: return ['HW', 'WH'];
            case 3: return ['HWC', 'CHW', 'BHW'];
            case 4: return ['BHWC', 'BCHW']; // Could add HWCB but rare
            default: return [];
        }
    }

    // Heuristic: Guess the most likely layout
    function guessLayout(shape) {
        const rank = shape.length;
        if (rank === 2) {return 'HW';}
        if (rank === 3) {
            // If last dim is 3 or 4 (RGB/RGBA), likely HWC
            if (shape[2] === 3 || shape[2] === 4) {return 'HWC';}
            // If first dim is 3 or 4, likely CHW (PyTorch style)
            if (shape[0] === 3 || shape[0] === 4) {return 'CHW';}
            // Otherwise assume Batch of Grey
            return 'BHW';
        }
        if (rank === 4) {
            // TensorFlow style
            if (shape[3] === 3 || shape[3] === 4) {return 'BHWC';}
            // PyTorch style
            if (shape[1] === 3 || shape[1] === 4) {return 'BCHW';}
            return 'BHWC'; // Fallback
        }
        return null;
    }

    // UI Rendering
    function initViewer(arrayData) {
        const shape = arrayData.shape;
        
        // 1. Determine Layout Options
        const possibleLayouts = getSupportedLayouts(shape.length);
        
        if (possibleLayouts.length === 0) {
            displayError(`Unsupported array rank: ${shape.length}D. Only 2D, 3D, and 4D arrays are supported.`);
            return;
        }

        // 2. Guess Default Layout
        if (!currentLayout || !possibleLayouts.includes(currentLayout)) {
            currentLayout = guessLayout(shape) || possibleLayouts[0];
        }

        // 1. 在渲染 UI 前，先计算当前的维度信息，获取 Channel 总数
        const dims = parseDimensions(shape, currentLayout);
        const maxChannelIndex = Math.max(0, dims.C - 1);

        // 2. 安全检查：如果之前的记录的下标超过了现在的最大值，重置为 0
        if (currentChannelStart > maxChannelIndex) {
            currentChannelStart = 0;
        }

        // 3. Render Skeleton (Metadata + Controls)
        const container = document.getElementById('main');
        container.innerHTML = ''; // Clear loading

        // Metadata Section
        const metadataDiv = document.createElement('div');
        metadataDiv.id = 'numpy-metadata';
        
        // Build Layout Options HTML
        const optionsHtml = possibleLayouts.map(l => 
            `<option value="${l}" ${l === currentLayout ? 'selected' : ''}>${l}</option>`
        ).join('');

        const showChannelControls = true;

        metadataDiv.innerHTML = `
            <h3>Metadata & Settings</h3>
            <div class='info-and-control-section'> 
                <div class='info-section'>
                    <div class="meta-row"><span class="label">Data Type:</span> <span>${arrayData.dtype}</span></div>
                    <div class="meta-row"><span class="label">Shape:</span> <span>${JSON.stringify(shape)}</span></div>
                </div>
                
                <div class='control-section'>
                    <div class="meta-row control-row">
                        <span class="label">Layout:</span> 
                        <select id="layout-selector">${optionsHtml}</select>
                    </div>

                    <div class="meta-row control-row">
                        <span class="label">Color Mode:</span> 
                        <select id="mode-selector">
                            <option value="auto" ${currentDisplayMode === 'auto' ? 'selected' : ''}>Auto</option>
                            <option value="gray" ${currentDisplayMode === 'gray' ? 'selected' : ''}>Grayscale</option>
                            <option value="rgb" ${currentDisplayMode === 'rgb' ? 'selected' : ''}>RGB</option>
                        </select>
                    </div>

                    <div class="meta-row control-row">
                        <span class="label">Channel Start:</span> 
                        <div style="display:flex; align-items:center; gap:5px;">
                            <input type="number" id="channel-start-input" class="small-input" 
                                value="${currentChannelStart}" 
                                min="0" 
                                max="${maxChannelIndex}">
                            <span id="channel-max-label" style="font-size: 0.8em; opacity: 0.7;">(0-${maxChannelIndex})</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(metadataDiv);

        const viewerContainer = document.createElement('div');
        viewerContainer.id = 'viewer-container';
        container.appendChild(viewerContainer);

        // --- Event Listeners ---
        const updateState = () => {
             vscode.setState({ 
                layout: currentLayout, 
                batchIndex: currentBatchIndex,
                displayMode: currentDisplayMode,
                channelStart: currentChannelStart
            });
            renderContent();
        };

        // 4. 修改 Layout 监听器：Layout 改变 -> C 改变 -> Max 改变
        document.getElementById('layout-selector').addEventListener('change', (e) => {
            currentLayout = e.target.value;
            currentBatchIndex = 0; 

            // 重新计算新的 C
            const newDims = parseDimensions(globalArrayData.shape, currentLayout);
            const newMax = Math.max(0, newDims.C - 1);
            
            // 更新 Input 的 Max 属性和提示文本
            const channelInput = document.getElementById('channel-start-input');
            const maxLabel = document.getElementById('channel-max-label');
            
            channelInput.setAttribute('max', newMax);
            maxLabel.innerText = `(0-${newMax})`;

            // 如果当前选中的值超过了新的最大值，自动修正
            if (currentChannelStart > newMax) {
                currentChannelStart = newMax;
                channelInput.value = newMax;
            }

            updateState();

            const rank = globalArrayData.shape.length;
            vscode.postMessage({ type: 'updateLayout', layout: currentLayout, rank: rank  });
        });

        document.getElementById('mode-selector').addEventListener('change', (e) => {
            currentDisplayMode = e.target.value;
            updateState();
        });

        // 5. 修改 Input 监听器：强制检查 min/max
        document.getElementById('channel-start-input').addEventListener('change', (e) => {
            let val = parseInt(e.target.value);
            const maxVal = parseInt(e.target.getAttribute('max')); // 获取当前的动态 max
            
            if (isNaN(val)) {val = 0;}
            if (val < 0) {val = 0;}
            if (val > maxVal) {val = maxVal;} // 限制最大值
            
            currentChannelStart = val;
            e.target.value = val; // 更新 UI 回显
            updateState();
        });

        renderContent();
    }

    // Decides whether to render a Single Image or Batch Viewer based on Layout
    function renderContent() {
        const container = document.getElementById('viewer-container');
        container.innerHTML = '';

        // Extract dimensions from shape based on current layout
        // e.g., shape=[3, 100, 100], layout='CHW' -> B=1, C=3, H=100, W=100
        const dims = parseDimensions(globalArrayData.shape, currentLayout);
        
        if (dims.B > 1) {
            renderBatchControls(container, dims);
        } else {
            // Single image (B=1)
            const wrapper = document.createElement('div');
            wrapper.className = 'canvas-wrapper';
            container.appendChild(wrapper);
            renderCanvas(wrapper, globalArrayData, currentLayout, 0, dims);
        }
    }

    function parseDimensions(shape, layout) {
        const map = { B: 1, C: 1, H: 1, W: 1 }; // Default values
        
        for (let i = 0; i < layout.length; i++) {
            const char = layout[i];
            map[char] = shape[i];
        }
        return map;
    }

    function renderBatchControls(container, dims) {
        const B = dims.B;
        
        const controls = document.createElement('div');
        controls.className = 'batch-controls info-section';
        controls.innerHTML = `
            <p>Batch Index: </p>
            <div class="slider-container">
                <input type="range" id="batch-slider" min="0" max="${B - 1}" value="${currentBatchIndex}" class="slider">
                <input type="number" id="index-input" value="${currentBatchIndex + 1}" min="1" max="${B}">
                <span class="batch-total"> / ${B}</span>
            </div>
        `;
        container.appendChild(controls);

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'canvas-wrapper';
        container.appendChild(canvasWrapper);

        const slider = controls.querySelector('#batch-slider');
        const input = controls.querySelector('#index-input');

        const updateUI = (idx) => {
            currentBatchIndex = idx;
            canvasWrapper.innerHTML = '';
            renderCanvas(canvasWrapper, globalArrayData, currentLayout, currentBatchIndex, dims);
        };

        const saveState = () => {
            vscode.setState({ 
                layout: currentLayout, 
                batchIndex: currentBatchIndex,
                displayMode: currentDisplayMode,
                channelStart: currentChannelStart 
            });
        };

        slider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            input.value = val + 1;
            updateUI(val);
            saveState();
        });

        input.addEventListener('change', (e) => {
            let val = parseInt(e.target.value) - 1;
            if (val < 0) {val = 0;}
            if (val >= B) {val = B - 1;}
            slider.value = val;
            updateUI(val);
            saveState();
        });

        // Initial render for batch
        updateUI(currentBatchIndex);
    }

    // Strided Rendering (Core)
    function renderCanvas(container, arrayData, layout, batchIndex, dims) {
    const { H, W, C } = dims;
    const rawData = arrayData.data;
    const dtype = arrayData.dtype; // We need dtype now to decide behavior

    // ... (Keep stride calculation and Canvas setup the same) ...
    const strides = calculateSemanticStrides(arrayData.shape, layout);
    const strideB = strides['B'], strideH = strides['H'], strideW = strides['W'], strideC = strides['C'];
    const batchOffset = batchIndex * strideB;
    
    let effectiveMode = currentDisplayMode;
    if (effectiveMode === 'auto') {effectiveMode = (C === 3 || C === 4) ? 'rgb' : 'gray';}
    
    const startC = currentChannelStart;

    // Canvas Setup
    const canvas = document.createElement('canvas');
    const MAX_W = 600, MAX_H = 600;
    const scale = Math.min(MAX_W / W, MAX_H / H, 10); 
    canvas.width = W; canvas.height = H;
    canvas.style.width = `${W * scale}px`; canvas.style.aspectRatio = `${W} / ${H}`;
    canvas.classList.add('numpy-canvas');
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(W, H);

    const toNum = (val) => (typeof val === 'bigint' ? Number(val) : val);

    // --- 1. Analyze Data Range (Min/Max) ---
    // We still scan the data to detect if it's standard 0-1 float or weird scientific data
    let min = Infinity, max = -Infinity;
    
    // Optimization: Skip steps for huge images to speed up analysis
    const skipStep = (H * W > 2000 * 2000) ? 10 : 1;

    for (let h = 0; h < H; h += skipStep) {
        for (let w = 0; w < W; w += skipStep) {
            const pixelBase = batchOffset + h * strideH + w * strideW;
            if (effectiveMode === 'gray') {
                if (startC < C) {
                    let val = toNum(rawData[pixelBase + startC * strideC]);
                    if (val < min) {min = val;}
                    if (val > max) {max = val;}
                }
            } else { // rgb
                for (let k = 0; k < 3; k++) {
                    if (startC + k < C) {
                        let val = toNum(rawData[pixelBase + (startC + k) * strideC]);
                        if (val < min) {min = val;}
                        if (val > max) {max = val;}
                    }
                }
            }
        }
    }

    // --- 2. Decide Normalization Strategy ---
    let useNormalization = false;
    let normMin = 0;
    let normRange = 1;

    // CASE A: Standard RGB Image (uint8) -> No Normalization
    if (effectiveMode === 'rgb' && dtype.includes('uint8')) {
        useNormalization = false; 
    } 
    // CASE B: Standard Float Image (0.0 - 1.0) -> Scale 0-1 to 0-255, but don't stretch
    else if (effectiveMode === 'rgb' && dtype.includes('float') && min >= 0 && max <= 1.0) {
        useNormalization = true;
        normMin = 0;
        normRange = 1.0; // Fixed range 0..1
    }
    // CASE C: Everything else (Grayscale, Scientific RGB, uint16, Negative values)
    // This catches your "low contrast grayscale" issue
    else {
        useNormalization = true;
        // Handle flat images
        if (min === max) { min -= 0.5; max += 0.5; }
        normMin = min;
        normRange = max - min;
    }

    // --- 3. Render Pixels ---
    for (let h = 0; h < H; h++) {
        for (let w = 0; w < W; w++) {
            const canvasIdx = (h * W + w) * 4;
            const pixelBaseIdx = batchOffset + h * strideH + w * strideW;

            let r = 0, g = 0, b = 0, a = 255;

            // Processor function based on strategy
            const processVal = (val) => {
                val = toNum(val);
                if (useNormalization) {
                    // Map [normMin, normMax] -> [0, 255]
                    return ((val - normMin) / normRange) * 255;
                }
                return val; // Return raw (clamped by Uint8ClampedArray later)
            };

            if (effectiveMode === 'gray') {
                let val = 0;
                if (startC < C) {
                    val = processVal(rawData[pixelBaseIdx + startC * strideC]);
                }
                r = g = b = val;
            } else {
                // RGB
                let vals = [0, 0, 0];
                for (let k = 0; k < 3; k++) {
                    if (startC + k < C) {
                        vals[k] = processVal(rawData[pixelBaseIdx + (startC + k) * strideC]);
                    }
                }
                r = vals[0];
                g = vals[1];
                b = vals[2];

                // Alpha (optional heuristic)
                if (startC === 0 && C === 4) {
                     let valA = toNum(rawData[pixelBaseIdx + 3 * strideC]);
                     // Assume Alpha follows the same rule as colors
                     if (useNormalization && normRange <= 1.0) {valA = valA * 255;}
                     else if (useNormalization && normRange > 255) {valA = ((valA - normMin)/normRange) * 255;}
                     a = valA;
                }
            }

            imgData.data[canvasIdx] = r;
            imgData.data[canvasIdx + 1] = g;
            imgData.data[canvasIdx + 2] = b;
            imgData.data[canvasIdx + 3] = a;
        }
    }

    ctx.putImageData(imgData, 0, 0);
    container.appendChild(canvas);
}

    function displayError(message) {
        const container = document.getElementById('main');
        container.innerHTML = `
            <div style="color: red; font-weight: bold; padding: 20px;">
                Error: ${message}
            </div>
        `;
    }

    // Notify the extension that the webview is ready
    vscode.postMessage({ type: 'ready' });
})();
