(function() {
    console.log("Webview script initializing...");
    const vscode = acquireVsCodeApi();

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
                renderArrayData(message.data);
                break;
            case 'error':
                displayError(message.message);
                break;
        }
    });
    

    function renderArrayData(arrayData) {
        const shape = arrayData.shape;

        const container = document.getElementById('main');
        
        // Create metadata display
        const metadataDiv = document.createElement('div');
        metadataDiv.id = 'numpy-metadata';
        metadataDiv.innerHTML = `
            <h3>Metadata</h3>
            <div class='info-section'> 
                <p>Data Type: ${arrayData.dtype}</p>
                <p>Shape: ${JSON.stringify(shape)}</p>
                ${shape.length === 4 
                    ? `<p>Batch Size: ${shape[0]}</p>` 
                    : ''}
            </div>
        `;
        container.innerHTML = ''; // Clear previous content
        container.appendChild(metadataDiv);

        // Attempt to render as image
        try {
            const imageCanvasMessage = createImageFromArray(arrayData);
            
            if (imageCanvasMessage.element) {
                container.appendChild(imageCanvasMessage.element);
            } else {
                const errorBlock = document.createElement('div');
                errorBlock.innerHTML = imageCanvasMessage.info;
                container.appendChild(errorBlock);
            }
        } catch (error) {
            sendMessage('error', 'Image rendering error: ' + error.message);
            console.error(error);
        }
    }

    function createImageFromArray(arrayData) {
        const shape = arrayData.shape;
        const filteredShape = shape.filter(i => i !== 1);
        const slen = filteredShape.length;

        const data = arrayData.data;
        const dtype = arrayData.dtype;
        

        // Channel-last case (common plt case)
        if (slen === 2) {
            // Grayscale image (HW)
            return renderGrayscaleImage(data, filteredShape[0], filteredShape[1], 500, 500);
        } else if (slen === 3 && (filteredShape[2] === 3 || filteredShape[2] === 4)) {
            // Color image (RGB or RGBA)
            return renderColorImage(data, filteredShape[0], filteredShape[1], filteredShape[2], 500, 500, dtype);
        } else if (slen === 3 || slen === 4) {
            // Batch data case
            const normalizedShape = slen === 3
                ? [filteredShape[0], filteredShape[1], filteredShape[2], 1]
                : filteredShape;

            const batchData = {
                data: data,
                shape: normalizedShape,
                dtype: dtype,
            };
            return renderBatchViewer(batchData);
        }

        const message = {
            info: "This npy format is not supported for preview. After filtering dimensions of size 1, the effective shape are [H,W], [H,W,C], [B,H,W,C]. If you believe your npy format is correct, please report this issue attached with your npy detail",
            element: null
        };
        return message;
    }

    function renderBatchViewer(arrayData) {
        const [B, H, W, C] = arrayData.shape;
        const dtype = arrayData.dtype;
        let currentIndex = 0;

        const wrapper = document.createElement('div');
        const canvasContainer = document.createElement('div');
        canvasContainer.id = `canvas-container`;

        wrapper.id = 'batch-viewer';
        wrapper.innerHTML = `
        <div class="info-section interactive-controls">
            <p>Current Image Index: </p>
            <div class="slider-container">
                <input type="range" id="batch-slider" min="0" max="${B > 1 ? B - 1 : 0}" value="0" class="slider">
                <input type="number" id="index-input" value="1" min="1" max="${B}">
                <span class="batch-total"> / ${B}</span>
            </div>
        </div>
        `;
        wrapper.appendChild(canvasContainer);

        const updateView = (index) => {
            const imageSize = H * W * C;
            const start = index * imageSize;
            const end = start + imageSize;
            const imageDataSlice = arrayData.data.slice(start, end);
            
            let singleImageResult;
            if (C === 1 || C === 0) { // C=0 is an edge case for empty dimension
                singleImageResult = renderGrayscaleImage(imageDataSlice, H, W, 500, 500);
            } else if (C === 3 || C === 4) {
                singleImageResult = renderColorImage(imageDataSlice, H, W, C, 500, 500, dtype);
            }

            canvasContainer.innerHTML = '';
            if (singleImageResult && singleImageResult.element) {
                canvasContainer.appendChild(singleImageResult.element);
            } else if (singleImageResult) {
                canvasContainer.innerHTML = singleImageResult.info;
            }
        };

        setTimeout(() => {
            const slider = wrapper.querySelector('#batch-slider');
            const indexInput = wrapper.querySelector('#index-input');

            // Event listener for the slider
            slider.addEventListener('input', () => {
                const newIndex = parseInt(slider.value, 10);
                if (currentIndex !== newIndex) {
                    currentIndex = newIndex;
                    indexInput.value = currentIndex + 1; // Sync number input
                    updateView(currentIndex);
                }
            });

            // Event listener for the number input
            indexInput.addEventListener('change', () => {
                let newIndex = parseInt(indexInput.value, 10) - 1; // Convert to 0-based index

                // Validate user input
                if (isNaN(newIndex) || newIndex < 0 || newIndex >= B) {
                    indexInput.value = currentIndex + 1; // Revert to last valid state
                    return;
                }

                if (currentIndex !== newIndex) {
                    currentIndex = newIndex;
                    slider.value = currentIndex; // Sync slider
                    updateView(currentIndex);
                }
            });
        }, 0);

        updateView(0); // render the first one
        return { element: wrapper, info: 'success' };
    }

    function renderGrayscaleImage(data, height, width, maxHeight, maxWidth) {
        const scale = Math.min(
            maxWidth / width,
            maxHeight / height
        );
        
        const mainCanvas = document.createElement('canvas');
        mainCanvas.classList.add('numpy-canvas');
        mainCanvas.width = width;
        mainCanvas.height = height;
    
        // Add styling to make canvas responsive and full-width
        mainCanvas.style.width = `${width * scale}px`;
        mainCanvas.style.height = `${height * scale}px`;
        mainCanvas.style.display = 'inline-block';
        mainCanvas.style.verticalAlign = 'top';
        mainCanvas.style.imageRendering = 'pixelated';
    
        const mainCtx = mainCanvas.getContext('2d');
        const imageData = mainCtx.createImageData(width, height);
    
        if (!data || data.length === 0) {
            return { 
                info: "No data to display.", 
                element: null
            };
        }

        let minVal = data[0], maxVal = data[0];
        for (let i = 1; i < data.length; i++) {
            if (data[i] < minVal) { minVal = data[i]; }
            if (data[i] > maxVal) { maxVal = data[i]; }
        }

        let normalizedData = data;
        const range = maxVal - minVal;
        if (range > 1e-6) {
            normalizedData = data.map(val => ((val - minVal) / range) * 255);
        } else {
            const constColor = minVal > 1.0 ? 255 : (minVal * 255);
            normalizedData = data.map(() => constColor);
        }
    
        for (let i = 0; i < height * width; i++) {
            const value = normalizedData[i];
            const canvasIndex = i * 4;
            imageData.data[canvasIndex] = value;     // R
            imageData.data[canvasIndex + 1] = value; // G
            imageData.data[canvasIndex + 2] = value; // B
            imageData.data[canvasIndex + 3] = 255;   // A
        }
    
        mainCtx.putImageData(imageData, 0, 0);
    
        // Create a wrapper div and append the canvases
        const wrapper = document.createElement('div');
        wrapper.id = 'numpy-wrapper';
        wrapper.innerHTML = `
            <h3>Grayscale Image Visualization</h3>
            <div class="info-section">
                <p>MaxVal = ${maxVal.toFixed(5)}</p>     
                <p>minVal = ${minVal.toFixed(5)}</p>
            </div>
        `;
        wrapper.appendChild(mainCanvas);
        
        const message = {
            info: "success",
            element: wrapper
        };
        return message;
    }

    function renderColorImage(data, height, width, channels, maxHeight, maxWidth, dtype) {
        const scale = Math.min(
            maxWidth / width,
            maxHeight / height
        );
        const canvas = document.createElement('canvas');
        canvas.id = 'color-numpy-canvas';
        canvas.classList.add('numpy-canvas');
        canvas.width = width;
        canvas.height = height;

        canvas.style.width = `${width * scale}px`;
        canvas.style.height = `${height * scale}px`;
        canvas.style.display = 'inline-block';
        canvas.style.verticalAlign = 'top';
        canvas.style.imageRendering = 'pixelated';

        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);
        
        let finalData = data;

        if (dtype && dtype.includes('float')) {
            let maxVal = 0;
            for (let i = 0; i < data.length; i++) {
                if (data[i] > maxVal) { maxVal = data[i]; }
            }
            
            // assume data is belong to [0, 1], need to multiply 255
            if (maxVal <= 1.05) { 
                finalData = data.map(val => val * 255);
            }
        }
        

        for (let i = 0; i < height * width; i++) {
            const dataIndex = i * channels;
            const canvasIndex = i * 4;
            imageData.data[canvasIndex] = finalData[dataIndex];         // R
            imageData.data[canvasIndex + 1] = finalData[dataIndex + 1]; // G
            imageData.data[canvasIndex + 2] = finalData[dataIndex + 2]; // B
            imageData.data[canvasIndex + 3] = channels === 4 ? finalData[dataIndex + 3] : 255; // A
        }

        ctx.putImageData(imageData, 0, 0);
        
        // Add some styling and title
        const wrapper = document.createElement('div');
        wrapper.innerHTML = '<h3>Color Image Visualization</h3>';
        wrapper.appendChild(canvas);
        
        const message = {
            info: "success",
            element: wrapper
        };
        return message;
    }

    function displayError(message) {
        const container = document.getElementById('main');
        container.innerHTML = `
            <div style="color: red; font-weight: bold;">
                Error: ${message}
            </div>
        `;
    }

    // Notify the extension that the webview is ready
    vscode.postMessage({ type: 'ready' });
})();
