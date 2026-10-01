// Runs in the browser. Preserve real paragraph/line breaks without innerText's
// extra layout-dependent spacing between ProseMirror paragraphs.
function comparePromptContent({ selector, prompt, waitForStable = false }) {
    const editor = document.querySelector(selector);
    const normalize = text => text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/[\u200B\uFEFF]/g, '').trim();
    const read = node => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        if (node.matches('script, style, .ProseMirror-trailingBreak, .prosemirror-placeholder')) return '';
        if (node.tagName === 'BR') return '\n';
        let text = '';
        let previousBlock = false;
        let hasChild = false;
        for (const child of node.childNodes) {
            const block = child.nodeType === Node.ELEMENT_NODE && /^(P|DIV|H[1-6]|BLOCKQUOTE|LI|UL|OL|PRE)$/.test(child.tagName);
            if (hasChild && (block || previousBlock)) text += '\n';
            text += read(child);
            previousBlock = block;
            hasChild = true;
        }
        return text;
    };
    const actual = normalize(!editor ? '' : editor instanceof HTMLTextAreaElement
        ? editor.value : editor.classList.contains('ProseMirror') ? read(editor) : editor.innerText);
    const expected = normalize(prompt);
    const matches = !!editor && actual === expected;
    let firstDifference = -1;
    if (!matches) {
        firstDifference = 0;
        while (firstDifference < Math.min(actual.length, expected.length) && actual[firstDifference] === expected[firstDifference]) firstDifference++;
    }
    const result = {
        matches, editorFound: !!editor, expectedLength: expected.length, actualLength: actual.length,
        expectedLines: expected.split('\n').length, actualLines: actual.split('\n').length, firstDifference,
        expectedCodePoint: firstDifference < 0 ? null : expected.codePointAt(firstDifference) ?? null,
        actualCodePoint: firstDifference < 0 ? null : actual.codePointAt(firstDifference) ?? null,
    };
    if (!waitForStable) return result;
    if (!matches) { window.__harumiPromptVerifiedSince = 0; return false; }
    window.__harumiPromptVerifiedSince ||= Date.now();
    return Date.now() - window.__harumiPromptVerifiedSince >= 400;
}

module.exports = { comparePromptContent };
