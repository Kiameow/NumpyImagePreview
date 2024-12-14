import * as vscode from 'vscode';
import { npyReadonlyEditor } from './npyReadonlyEditor';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(npyReadonlyEditor.register(context));
}
