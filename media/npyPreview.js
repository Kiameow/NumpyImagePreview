(function() {
    console.log("Webview script initializing...");
    const vscode = acquireVsCodeApi();

    // Global State
    let globalArrayData = null;
    let currentLayout = ''; // e.g., 'HWC', 'CHW', 'BCHW'
    let currentBatchIndex = 0;

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

        metadataDiv.innerHTML = `
            <h3>Metadata & Settings</h3>
            <div class='info-section'> 
                <div class="meta-row"><span class="label">Data Type:</span> <span>${arrayData.dtype}</span></div>
                <div class="meta-row"><span class="label">Shape:</span> <span>${JSON.stringify(shape)}</span></div>
                <div class="meta-row control-row">
                    <span class="label">Data Layout:</span> 
                    <select id="layout-selector">
                        ${optionsHtml}
                    </select>
                </div>
            </div>
        `;
        container.appendChild(metadataDiv);

        // Viewer Container
        const viewerContainer = document.createElement('div');
        viewerContainer.id = 'viewer-container';
        container.appendChild(viewerContainer);

        // Event Listeners
        document.getElementById('layout-selector').addEventListener('change', (e) => {
            currentLayout = e.target.value;
            currentBatchIndex = 0; // Reset batch index on layout change
            renderContent();
        });

        // Initial Render
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

        // Calculate strides
        // semanticStrides.B tells us how many flat-array steps to jump for 1 batch
        const strides = calculateSemanticStrides(arrayData.shape, layout);
        const strideB = strides['B'];
        const strideH = strides['H'];
        const strideW = strides['W'];
        const strideC = strides['C'];

        // Calculate Base Offset for this specific image in the batch
        const batchOffset = batchIndex * strideB;

        // Create Canvas
        const canvas = document.createElement('canvas');
        // Fit to screen logic
        const MAX_W = 600;
        const MAX_H = 600;
        const scale = Math.min(MAX_W / W, MAX_H / H, 5); // Limit upscaling too
        
        canvas.width = W;
        canvas.height = H;
        canvas.style.width = `${W * scale}px`;
        
        canvas.style.aspectRatio = `${W} / ${H}`;
        canvas.classList.add('numpy-canvas');

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;  // actually, only enabling features in css could also make it pixelated
        const imgData = ctx.createImageData(W, H);

        // --- Normalization Setup ---
        // Find Min/Max for contrast stretching (only if float or weird range)
        // Optimization: For huge arrays, maybe only sample a subset or just use strict type limits?
        // For now, let's just scan the *current slice* to be safe and accurate.
        let min = Infinity, max = -Infinity;
        
        // We need a helper to read values efficiently
        const isFloat = dtype.includes('float');
        const isInt = dtype.includes('int');

        // Note: Scanning logic also needs to respect strides to be accurate to the viewed image
        // but for performance, we might skip full scan if we assume 0-1 or 0-255.
        // Let's implement a robust scan for the current view.
        
        if (isFloat) {
            // Quick scan of the visible slice
            for (let h = 0; h < H; h += Math.max(1, Math.floor(H/50))) { // subsample for speed
                for (let w = 0; w < W; w += Math.max(1, Math.floor(W/50))) {
                    const c0 = rawData[batchOffset + h * strideH + w * strideW]; // Sample first channel
                    if (c0 < min) {min = c0;}
                    if (c0 > max) {max = c0;}
                }
            }
            // Fallback for flat image
            if (min === max) { min = 0; max = 1; }
        }

        // --- Pixel Filling Loop ---
        for (let h = 0; h < H; h++) {
            for (let w = 0; w < W; w++) {
                const canvasIdx = (h * W + w) * 4;
                
                // Calculate base index for this pixel (0th channel)
                const pixelBaseIdx = batchOffset + h * strideH + w * strideW;

                let r, g, b, a = 255;

                if (C === 1) {
                    // Grayscale
                    let val = rawData[pixelBaseIdx]; // C stride is 0 or irrelevant here
                    if (isFloat) {
                         val = (val - min) / (max - min) * 255;
                    }
                    r = g = b = val;
                } else {
                    // Color
                    // We assume RGB or RGBA. 
                    // Important: We need to handle if layout has 'C' but strideC jumps correctly
                    
                    let valR = rawData[pixelBaseIdx + 0 * strideC];
                    let valG = rawData[pixelBaseIdx + 1 * strideC];
                    let valB = rawData[pixelBaseIdx + 2 * strideC];
                    
                    if (isFloat) {
                        // Assume 0-1 float for color, or use max/min if needed. 
                        // Usually float RGB is 0.0-1.0
                        if (max <= 1.05 && min >= -0.05) {
                            valR *= 255; valG *= 255; valB *= 255;
                        } else {
                            valR = (valR - min) / (max - min) * 255;
                            valG = (valG - min) / (max - min) * 255;
                            valB = (valB - min) / (max - min) * 255;
                        }
                    }

                    r = valR;
                    g = valG;
                    b = valB;

                    if (C === 4) {
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
