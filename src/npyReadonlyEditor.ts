import * as vscode from 'vscode';
import { NpyFileParser } from './npyFileParser'; 

export class npyReadonlyEditor implements vscode.CustomReadonlyEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new npyReadonlyEditor(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(npyReadonlyEditor.viewType, provider);
		return providerRegistration;
	}

    private static readonly viewType = 'npy-image-preview.preview';

    constructor(
		private readonly context: vscode.ExtensionContext
	) { }

    openCustomDocument(
        uri: vscode.Uri, 
        openContext: vscode.CustomDocumentOpenContext, 
        token: vscode.CancellationToken
    ): vscode.CustomDocument | Thenable<vscode.CustomDocument> {
        return {
            uri,
            dispose: () => {} // Cleanup method if needed
        };
    }

    resolveCustomEditor(
        document: vscode.CustomDocument, 
        webviewPanel: vscode.WebviewPanel, 
        token: vscode.CancellationToken
    ): void {
        // Always set up the webview options and HTML
        webviewPanel.webview.options = {
            enableScripts: true
        };

        // Render HTML
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document.uri);

        let arrayData;
        try {
            arrayData = NpyFileParser.parseNpyFile(document.uri.fsPath);
        } catch (error) {
            console.error('Error parsing NPY file:', error);
            arrayData = null;
        }

        // Always attempt to send data, even if cached or newly parsed
        webviewPanel.webview.onDidReceiveMessage(message => {
            if (message.type === 'ready') {
                if (arrayData) {
                    webviewPanel.webview.postMessage({
                        type: 'arrayData',
                        data: arrayData
                    });
                } else {
                    webviewPanel.webview.postMessage({
                        type: 'error',
                        message: 'Failed to parse NPY file'
                    });
                }
            } else {
                console.log(`[${message.type}] ${message.info}`);
            }
        });
    }

    /**
     * Generate HTML for the webview
     */
    private getHtmlForWebview(webview: vscode.Webview, uri: vscode.Uri): string {
        // Get propriate font color & border color according to user theme 
        let fontColor;
        const theme = vscode.window.activeColorTheme;
        switch(theme.kind) {
            case vscode.ColorThemeKind.Dark:
                fontColor = '#ffffff';
                break;
            case vscode.ColorThemeKind.Light:
                fontColor = '#000000';
                break;
            case vscode.ColorThemeKind.HighContrast:
                fontColor = '#ffffff';
                break;
            case vscode.ColorThemeKind.HighContrastLight:
                fontColor = '#000000';
                break;
            default:
                fontColor = '#000000';
        }

	    
        // Local path to script for the webview
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'npyPreview.js'));

        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'npyPreview.css'));

        // Use a nonce to only allow specific scripts
        const nonce = this.getNonce();

        return `
            <!DOCTYPE html>
            <html lang="en" style="color:${fontColor}">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" 
                      content="default-src 'none'; 
                               script-src 'nonce-${nonce}'; 
                               style-src ${webview.cspSource};">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet" />
                <title>NumPy Image Preview</title>
            </head>
            <body>
                <div id="main">
                    <h2>NumPy Image Preview</h2>
                    <pre class="loading">Loading npy data...</pre>
                </div>
                
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    /**
     * Generate a cryptographically secure nonce
     */
    private getNonce(): string {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        const charactersLength = characters.length;
        for (let i = 0; i < 32; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }
    
}
