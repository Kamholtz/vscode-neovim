import path from "path";
import { strict as assert } from "assert";

import vscode from "vscode";
import { NeovimClient } from "neovim";

import {
    attachTestNvimClient,
    assertContent,
    wait,
    setCursor,
    sendVSCodeKeys,
    closeAllActiveEditors,
    sendEscapeKey,
    closeNvimClient,
} from "../utils";

describe("VSCode integration specific stuff", () => {
    let client: NeovimClient;
    before(async () => {
        client = await attachTestNvimClient();
    });
    after(async () => {
        await closeNvimClient(client);
    });

    afterEach(async () => {
        await closeAllActiveEditors();
    });

    it("Doesnt move cursor on peek definition", async () => {
        const doc = await vscode.workspace.openTextDocument({
            content: 'declare function test(a: number): void;\n\ntest("")\n',
            language: "typescript",
        });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        await wait();
        await setCursor(2, 1, 1000);

        // peek definition opens another editor. make sure the cursor won't be leaked into primary editor
        await vscode.commands.executeCommand("editor.action.peekDefinition", doc.uri, new vscode.Position(2, 1));
        await wait();

        await assertContent(
            {
                cursor: [2, 1],
            },
            client,
        );
    });

    it("Moves on cursor on go definition", async () => {
        const doc = await vscode.workspace.openTextDocument({
            content: 'declare function test(a: number): void;\n\ntest("")\n',
            language: "typescript",
        });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        await wait();
        await setCursor(2, 1);

        await vscode.commands.executeCommand("editor.action.goToTypeDefinition", doc.uri, new vscode.Position(2, 1));

        await assertContent(
            {
                cursor: [0, 17],
            },
            client,
        );
    });

    it("Editor cursor revealing", async () => {
        const doc = await vscode.workspace.openTextDocument(
            path.join(__dirname, "../../../test_fixtures/scrolltest.txt"),
        );
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        await wait(1000);

        await sendVSCodeKeys("90j", 2000);
        await assertContent({ cursor: [90, 0], vsCodeVisibleRange: { bottom: 90 } }, client);

        await sendVSCodeKeys("zt", 2000);
        await assertContent({ cursor: [90, 0], vsCodeVisibleRange: { top: 90 } }, client);

        // await sendVSCodeKeys("40k", 1000);
        // await assertContent({ cursor: [90, 0], vsCodeVisibleRange: { bottom: 50 } }, client);
    });

    it("Scrolling actions", async () => {
        const doc = await vscode.workspace.openTextDocument(
            path.join(__dirname, "../../../test_fixtures/scrolltest.txt"),
        );
        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        await wait(1000);
        await vscode.commands.executeCommand("vscode-neovim.ctrl-f");
        await wait(1500);

        let winline = await client.callFunction("winline", []);
        assert.equal(winline, 1);
        await assertContent(
            {
                cursor: [editor.visibleRanges[0].start.line, 0],
            },
            client,
        );

        await sendVSCodeKeys("L", 1500);
        winline = await client.callFunction("winline", []);
        const lines = editor.visibleRanges[0].end.line - editor.visibleRanges[0].start.line;
        assert.ok(winline <= lines);
        assert.ok(winline >= lines - 3);

        await sendVSCodeKeys("M", 1500);
        winline = await client.callFunction("winline", []);
        assert.ok(winline <= lines / 2 + 2);
        assert.ok(winline >= lines / 2 - 2);
        let cursorLine = editor.selection.active.line;
        assert.ok(cursorLine <= editor.visibleRanges[0].start.line + (lines / 2 + 2));
        assert.ok(cursorLine >= editor.visibleRanges[0].start.line + (lines / 2 - 2));

        await sendVSCodeKeys("H", 1500);
        winline = await client.callFunction("winline", []);
        assert.equal(winline, 1);
        cursorLine = editor.selection.active.line;
        assert.equal(cursorLine, editor.visibleRanges[0].start.line);
    });

    it("Go to definition in other file - cursor is ok", async () => {
        const doc2 = await vscode.workspace.openTextDocument(path.join(__dirname, "../../../test_fixtures/b.ts"));
        await vscode.window.showTextDocument(doc2, vscode.ViewColumn.One);
        await wait();

        await setCursor(3, 1);

        await vscode.commands.executeCommand("editor.action.goToTypeDefinition", doc2.uri, new vscode.Position(2, 1));
        await wait(1500);

        await assertContent(
            {
                cursor: [4, 16],
                content: [
                    'export const a = "blah";',
                    "",
                    'export const b = "blah";',
                    "",
                    "export function someFunc(): void;",
                    "",
                ],
            },
            client,
        );
    });

    it("Preserving cursor style when switching between editors", async () => {
        const doc1 = await vscode.workspace.openTextDocument({
            content: "blah1",
        });
        await vscode.window.showTextDocument(doc1, vscode.ViewColumn.One);
        await wait();
        const doc2 = await vscode.workspace.openTextDocument({
            content: "blah2",
        });
        await vscode.window.showTextDocument(doc2, vscode.ViewColumn.Two);
        await wait();

        await sendVSCodeKeys("i");
        await assertContent(
            {
                content: ["blah2"],
                cursorStyle: "line",
            },
            client,
        );

        await vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
        await wait();

        await assertContent(
            {
                content: ["blah1"],
                cursorStyle: "line",
            },
            client,
        );
        await sendEscapeKey();
        await assertContent(
            {
                cursorStyle: "block",
            },
            client,
        );

        await vscode.commands.executeCommand("workbench.action.focusSecondEditorGroup");
        await wait();
        await assertContent(
            {
                content: ["blah2"],
                cursorStyle: "block",
            },
            client,
        );
    });

    it("Cursor is ok when go to def into editor in the other pane", async () => {
        const doc1 = await vscode.workspace.openTextDocument(path.join(__dirname, "../../../test_fixtures/b.ts"));
        await vscode.window.showTextDocument(doc1, vscode.ViewColumn.One);
        await wait();

        const doc2 = await vscode.workspace.openTextDocument(
            path.join(__dirname, "../../../test_fixtures/def-with-scroll.ts"),
        );
        const editor2 = await vscode.window.showTextDocument(doc2, vscode.ViewColumn.Two, true);
        await wait();

        setCursor(5, 1);

        await vscode.commands.executeCommand("editor.action.goToTypeDefinition", doc1.uri, new vscode.Position(5, 1));
        await wait(1500);

        assert.ok(vscode.window.activeTextEditor === editor2);
        await assertContent(
            {
                cursor: [115, 16],
            },
            client,
        );
    });

    it("Cursor is ok for incsearch after scroll", async () => {
        const doc = await vscode.workspace.openTextDocument(
            path.join(__dirname, "../../../test_fixtures/def-with-scroll.ts"),
        );
        const e = await vscode.window.showTextDocument(doc);
        await wait(1000);

        await sendVSCodeKeys("/bla", 1000);

        await assertContent({ cursor: [115, 19] }, client);
        assert.ok(e.visibleRanges[0].start.line < 115);
    });

    it("Winline is ok after exiting insearch on result", async () => {
        const doc = await vscode.workspace.openTextDocument(
            path.join(__dirname, "../../../test_fixtures/def-with-scroll.ts"),
        );
        const e = await vscode.window.showTextDocument(doc);
        await wait(1000);

        await sendVSCodeKeys("/blah2", 1000);
        await sendVSCodeKeys("\n");

        await wait();
        const screenRow = e.visibleRanges[0].end.line - e.selection.active.line;
        const winline = await client.callFunction("winline", []);

        assert.ok(screenRow + 1 === winline);
    });
});
