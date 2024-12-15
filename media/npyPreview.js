(function() {
    console.log("Webview script initializing...");
    const vscode = acquireVsCodeApi();

    // Always send ready message, but handle potential race conditions
    function sendReadyMessage() {
        console.log("Sending ready message");
        vscode.postMessage({ type: 'ready' });
    }

    // If document is already loaded, send ready immediately
    if (document.readyState === 'complete') {
        sendReadyMessage();
    } else {
        // Otherwise, wait for document to load
        window.addEventListener('load', sendReadyMessage);
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
        const container = document.getElementById('array-container');
        container.innerHTML = ''; // Clear previous content

        // Create metadata display
        const metadataDiv = document.createElement('div');
        metadataDiv.innerHTML = `
            <h3>Metadata</h3>
            <div class='info-section'> 
                <p>Data Type: ${arrayData.dtype} ;</p>
                <p>Shape: ${JSON.stringify(arrayData.shape)} ;</p>
            </div>
        `;
        container.appendChild(metadataDiv);

        // Attempt to render as image
        try {
            const imageCanvas = createImageFromArray(arrayData);
            if (imageCanvas) {
                container.appendChild(imageCanvas);
            }
        } catch (error) {
            console.error('Image rendering error:', error);
        }
    }

    function createImageFromArray(arrayData) {
        const data = arrayData.data;
        const shape = arrayData.shape;

        // Check if array looks like an image
        if (shape.length === 2) {
            // Grayscale image
            return renderGrayscaleImage(data, shape[1], shape[0]);
        } else if (shape.length === 3 && (shape[2] === 3 || shape[2] === 4)) {
            // Color image (RGB or RGBA)
            return renderColorImage(data, shape[1], shape[0], shape[2]);
        }

        return null;
    }

    function renderGrayscaleImage(data, width, height) {
        const mainCanvas = document.createElement('canvas');
        mainCanvas.width = width;
        mainCanvas.height = height;
    
        // Add styling to make canvas responsive and full-width
        mainCanvas.style.width = '100%';
        mainCanvas.style.height = 'auto';
        mainCanvas.style.display = 'inline-block';
        mainCanvas.style.verticalAlign = 'top';
    
        const mainCtx = mainCanvas.getContext('2d');
        const imageData = mainCtx.createImageData(width, height);
    
        let normalizedData = [];
    
        const maxVal = Math.max(...data);
        const minVal = Math.min(...data);
        const cover = maxVal - minVal;
        if (cover > 0.00001) {
            normalizedData = data.map((ele, idx) => {
                return ele / cover * 255;
            });
        }
    
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                const index = i * width + j;
                const value = normalizedData[index];
    
                imageData.data[index * 4] = value;     // R
                imageData.data[index * 4 + 1] = value; // G
                imageData.data[index * 4 + 2] = value; // B
                imageData.data[index * 4 + 3] = 255;   // A
            }
        }
    
        mainCtx.putImageData(imageData, 0, 0);
    
        // Create a wrapper div and append the canvases
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <h3>Grayscale Image Visualization</h3>
            <div class="info-section">
                <p>MaxVal = ${maxVal.toFixed(5)} ;</p>     
                <p>minVal = ${minVal.toFixed(5)} ;</p>
            </div>
        `;
        wrapper.appendChild(mainCanvas);
    
        return wrapper;
    }

    function renderColorImage(data, width, height, channels) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.style.display = 'inline-block';
        canvas.style.verticalAlign = 'top';

        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(width, height);

        // Separate channels
        const channelData = [];
        for (let c = 0; c < channels; c++) {
            const channel = data.filter((_, idx) => idx % channels === c);
            channelData.push(channel);
        }

        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                const index = i * width + j;
                imageData.data[index * 4] = channelData[0][index];     // R
                imageData.data[index * 4 + 1] = channelData[1][index]; // G
                imageData.data[index * 4 + 2] = channelData[2][index]; // B
                imageData.data[index * 4 + 3] = channels === 4 
                    ? channelData[3][index] 
                    : 255;   // A
            }
        }

        ctx.putImageData(imageData, 0, 0);
        
        // Add some styling and title
        const wrapper = document.createElement('div');
        wrapper.innerHTML = '<h3>Color Image Visualization</h3>';
        wrapper.appendChild(canvas);
        
        return wrapper;
    }

    function displayError(message) {
        const container = document.getElementById('array-container');
        container.innerHTML = `
            <div style="color: red; font-weight: bold;">
                Error: ${message}
            </div>
        `;
    }

    // Notify the extension that the webview is ready
    vscode.postMessage({ type: 'ready' });
})();
