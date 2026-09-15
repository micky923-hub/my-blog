// frontmatter 파싱
function parseFrontmatter(rawText) {
  var result = { metadata: {}, content: rawText };
  var text = rawText.trim();

  if (!text.startsWith('---')) return result;

  var endIndex = text.indexOf('---', 3);
  if (endIndex === -1) return result;

  var yamlBlock = text.substring(3, endIndex).trim();
  var content = text.substring(endIndex + 3).trim();
  var metadata = {};

  yamlBlock.split('\n').forEach(function(line) {
    var colonIndex = line.indexOf(':');
    if (colonIndex === -1) return;

    var key = line.substring(0, colonIndex).trim();
    var value = line.substring(colonIndex + 1).trim();

    if (key === 'tags') {
      value = value.replace(/^\[/, '').replace(/\]$/, '');
      metadata[key] = value.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    } else {
      metadata[key] = value;
    }
  });

  return { metadata: metadata, content: content };
}

// 마크다운 → HTML 변환 (marked.js 래퍼)
function renderMarkdown(markdownText) {
  if (typeof marked === 'undefined') {
    return '<p>' + markdownText + '</p>';
  }
  return marked.parse(markdownText, { gfm: true, breaks: false });
}

// 코드 블록 구문 강조
function highlightCodeBlocks() {
  if (typeof hljs !== 'undefined') {
    hljs.highlightAll();
  }
}

// 날짜 포맷 (YYYY-MM-DD → YYYY년 M월 D일)
function formatDate(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return parts[0] + '년 ' + parseInt(parts[1]) + '월 ' + parseInt(parts[2]) + '일';
}
