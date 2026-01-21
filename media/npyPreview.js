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
                // renderArrayData(message.data);
                if (!currentLayout) {
                    if (message.preferredLayout) {
                        currentLayout = message.preferredLayout;
                    } else {
                        currentLayout = guessLayout(globalArrayData.shape);
                    }
                }

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

        const updateBatch = (idx) => {
            currentBatchIndex = idx;
            vscode.setState({ layout: currentLayout, batchIndex: currentBatchIndex });
            canvasWrapper.innerHTML = '';
            // Pass the batch index to the renderer
            renderCanvas(canvasWrapper, globalArrayData, currentLayout, currentBatchIndex, dims);
        };

        slider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            input.value = val + 1;
            updateBatch(val);
        });

        input.addEventListener('change', (e) => {
            let val = parseInt(e.target.value) - 1;
            if (val < 0) {val = 0;}
            if (val >= B) {val = B - 1;}
            slider.value = val;
            updateBatch(val);
        });

        // Initial render for batch
        updateBatch(currentBatchIndex);
    }

    // Strided Rendering (Core)
    function renderCanvas(container, arrayData, layout, batchIndex, dims) {
        const { H, W, C } = dims;
        const rawData = arrayData.data;
        const dtype = arrayData.dtype;

        const strides = calculateSemanticStrides(arrayData.shape, layout);
        const strideB = strides['B'];
        const strideH = strides['H'];
        const strideW = strides['W'];
        const strideC = strides['C'];

        const batchOffset = batchIndex * strideB;

        // --- 确定实际的显示模式 ---
        let effectiveMode = currentDisplayMode;
        if (effectiveMode === 'auto') {
            effectiveMode = (C === 3 || C === 4) ? 'rgb' : 'gray';
        }

        // --- 确定要使用的通道 ---
        // 如果 Layout 里没有 'C' (例如 'HW'), strideC 应该是 0, C 是 1
        const startC = currentChannelStart;
        
        // --- Canvas Setup ---
        const canvas = document.createElement('canvas');
        const MAX_W = 600;
        const MAX_H = 600;
        const scale = Math.min(MAX_W / W, MAX_H / H, 10); 
        
        canvas.width = W;
        canvas.height = H;
        canvas.style.width = `${W * scale}px`;
        canvas.style.aspectRatio = `${W} / ${H}`;
        canvas.classList.add('numpy-canvas');

        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(W, H);

        // --- 归一化逻辑 (Find Min/Max) ---
        // 注意：为了正确的对比度，我们只应该扫描当前用户选择看到的那些通道
        let min = Infinity, max = -Infinity;
        const isFloat = dtype.includes('float');
        
        if (isFloat) {
            // 简单采样：只采中间的部分或者跳步采样，提高大图性能
            const stepH = Math.max(1, Math.floor(H/50));
            const stepW = Math.max(1, Math.floor(W/50));

            for (let h = 0; h < H; h += stepH) {
                for (let w = 0; w < W; w += stepW) {
                    const pixelBase = batchOffset + h * strideH + w * strideW;
                    
                    if (effectiveMode === 'gray') {
                        // 检查边界，防止读取越界
                        if (startC < C) {
                            const val = rawData[pixelBase + startC * strideC];
                            if (val < min) {min = val;}
                            if (val > max) {max = val;}
                        }
                    } else { // rgb
                        for (let k = 0; k < 3; k++) {
                            if (startC + k < C) {
                                const val = rawData[pixelBase + (startC + k) * strideC];
                                if (val < min) {min = val;}
                                if (val > max) {max = val;}
                            }
                        }
                    }
                }
            }
            if (min === max) { min = 0; max = 1; }
            if (min > 0 && max <= 1.0) { min = 0; max = 1; } // 0-1范围优化
        }

        // --- 像素填充 ---
        for (let h = 0; h < H; h++) {
            for (let w = 0; w < W; w++) {
                const canvasIdx = (h * W + w) * 4;
                const pixelBaseIdx = batchOffset + h * strideH + w * strideW;

                let r = 0, g = 0, b = 0, a = 255;

                if (effectiveMode === 'gray') {
                    // Gray: 拿 startC 这个通道
                    let val = 0;
                    if (startC < C) {
                        val = rawData[pixelBaseIdx + startC * strideC];
                    }
                    
                    if (isFloat) {val = (val - min) / (max - min) * 255;}
                    r = g = b = val;
                } else {
                    // RGB: 拿 startC, startC+1, startC+2
                    let vals = [0, 0, 0]; // R, G, B
                    for (let k = 0; k < 3; k++) {
                        if (startC + k < C) {
                            vals[k] = rawData[pixelBaseIdx + (startC + k) * strideC];
                        }
                    }

                    if (isFloat) {
                        vals[0] = (vals[0] - min) / (max - min) * 255;
                        vals[1] = (vals[1] - min) / (max - min) * 255;
                        vals[2] = (vals[2] - min) / (max - min) * 255;
                    }
                    r = vals[0];
                    g = vals[1];
                    b = vals[2];

                    // Alpha Support? 如果是 RGBA 模式且刚好是4通道，可以考虑。
                    // 但这里的需求是指定起始 Channel，为了简单，RGB模式下暂不处理Alpha，除非我们增加RGBA模式
                    // 或者如果用户在start=0选了RGB且C=4，我们展示A。
                    if (startC === 0 && C === 4) {
                         let valA = rawData[pixelBaseIdx + 3 * strideC];
                         if (isFloat && max <= 1.05) {valA *= 255;} 
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
