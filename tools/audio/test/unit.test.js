/* 변환기(listen-text)·대본 검사(check-summary) 단위 시험 */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var h = require('./helpers');
var lt = require('../listen-text');
var cs = require('../check-summary');
var gen = require('../generate');

var PRON = lt.loadPronunciations(path.join(h.REPO, 'audio', 'pronunciations.json'));
var FIX = path.join(__dirname, 'fixtures');

function post(body, title) {
  return '---\ntitle: ' + (title || '시험 글') + '\ndate: 2026-10-13\n---\n\n' + body + '\n';
}
function convert(body) {
  return lt.postListenText(post(body), { pronunciations: PRON });
}
function has(text, part) {
  assert.ok(text.indexOf(part) !== -1, '기대한 문장이 없음: "' + part + '"\n--- 결과 ---\n' + text);
}
function hasNot(text, part) {
  assert.ok(text.indexOf(part) === -1, '있으면 안 되는 문장: "' + part + '"\n--- 결과 ---\n' + text);
}

module.exports = function(t) {
  t.test('시작·끝 문장', function() {
    var out = convert('본문입니다.');
    assert.ok(out.startsWith('시험 글. 파이낸셜 다이어리가 읽어 드립니다.'));
    assert.ok(out.endsWith('이 음성은 AI가 글을 읽은 것입니다. 숫자와 표는 글에서 다시 확인하세요.'));
  });

  t.test('작은 표(6행·3열 이하)는 행마다 문장으로', function() {
    var out = convert('| 유형 | 가입 조건 | 비과세 한도 |\n|---|---|---|\n| 일반형 | 만 19세 이상 | 200만 원 |\n| 서민형 | 총급여 5,000만 원 이하 | 400만 원 |');
    has(out, '일반형, 가입 조건 만 19세 이상, 비과세 한도 200만 원.');
    has(out, '서민형, 가입 조건 총급여 5000만 원 이하, 비과세 한도 400만 원.');
    hasNot(out, '|');
  });

  t.test('큰 표(7행 또는 4열)는 "글에서 확인하세요"', function() {
    var rows = '| 가 | 나 |\n|---|---|\n' + [1, 2, 3, 4, 5, 6, 7].map(function(i) { return '| ' + i + '번 | 값 |'; }).join('\n');
    has(convert(rows), '이 부분의 표는 글에서 확인하세요.');
    var wide = '| 가 | 나 | 다 | 라 |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |';
    has(convert(wide), '이 부분의 표는 글에서 확인하세요.');
    hasNot(convert(wide), '|');
  });

  t.test('그림은 alt만, 링크는 글자만, 맨 주소는 읽지 않음', function() {
    var out = convert('![세금 비교 막대 그림](/images/posts/a.svg)\n\n자세한 내용은 [ISA 가이드](/posts/isa.html)를 보세요. 출처 https://example.com/x 입니다.');
    has(out, '그림 설명. 세금 비교 막대 그림.');
    has(out, '자세한 내용은 아이에스에이 가이드를 보세요.');
    hasNot(out, 'http');
    hasNot(out, '/posts/');
  });

  t.test('3줄 요약 → "먼저 세 줄 요약입니다. 첫째, …"', function() {
    var out = convert('> **바쁜 분을 위한 3줄 요약**\n>\n> 1. 계좌부터 **먼저** 만드세요.\n> 2. 세금 붙는 상품을 담으세요.\n> 3. 만기 60일을 지키세요.');
    has(out, '먼저 세 줄 요약입니다. 첫째, 계좌부터 먼저 만드세요. 둘째, 세금 붙는 상품을 담으세요. 셋째, 만기 60일을 지키세요.');
    hasNot(out, '바쁜 분');
  });

  t.test('쿠팡 상자는 통째로 읽지 않음, 글 끝 링크 상자는 한 문장', function() {
    var body = '본문.\n\n---\n\n> 📚 **함께 읽으면 좋은 글**  \n> [가](/posts/a.html) · [나](/posts/b.html)\n\n<!-- coupang:start -->\n- [블랙박스](https://link.coupang.com/a/x)\n  - 고른 이유: 값이 쌉니다.\n<!-- coupang:end -->';
    var out = convert(body);
    hasNot(out, '블랙박스');
    hasNot(out, '고른 이유');
    hasNot(out, '함께 읽으면');
    has(out, '관련 글과 계산기는 글 아래 링크에서 볼 수 있어요.');
    assert.strictEqual(out.split('관련 글과 계산기는').length - 1, 1);
  });

  t.test('기호: ~ % · → ※ × − = ÷ ( ) /', function() {
    var out = convert('200만~400만 원, 15.4%, 이자·배당, 가입 → 이전, ※ 참고 문장, 100만 원 × 9.9% = 9만 9천 원, (1,000만 − 200만) ÷ 2, 서민형(400만 원) 기준, 연금저축/IRP 선택.');
    has(out, '200만에서 400만 원');
    has(out, '15.4퍼센트');
    has(out, '이자, 배당');
    has(out, '가입, 그다음 이전');
    has(out, '참고로, 참고 문장');
    has(out, '100만 원 곱하기 9.9퍼센트 은 9만 9천 원');
    has(out, '1000만 빼기 200만');
    has(out, '나누기 2');
    has(out, '서민형, 400만 원, 기준');
    has(out, '연금저축 또는 아이알피 선택');
    ['~', '%', '·', '→', '※', '×', '−', '=', '÷', '(', ')'].forEach(function(c) { hasNot(out, c); });
  });

  t.test('숫자 쉼표·발음 사전(단어 경계)', function() {
    var out = convert('ISA계좌와 IRP, ETF, DC형과 DB형, S&P500 지수. 1,234,567원. ISAX 와 MYETF 는 그대로.');
    has(out, '아이에스에이계좌와 아이알피, 이티에프, 디씨형과 디비형, 에스앤피 오백 지수.');
    has(out, '1234567원');
    has(out, 'ISAX');
    has(out, 'MYETF');
  });

  t.test('굵게·이모지·HTML 주석·코드 블록 제거, 소제목은 "다음은,"', function() {
    var out = convert('## 연금저축부터 **채우세요**\n\n<!-- 메모 -->\n🐷 **0원**입니다.\n\n```\ncode()\n```\n\n- 항목 하나\n- 항목 둘.');
    has(out, '다음은, 연금저축부터 채우세요.');
    has(out, '0원입니다.');
    has(out, '항목 하나. 항목 둘.');
    ['**', '🐷', '메모', 'code()'].forEach(function(c) { hasNot(out, c); });
  });

  t.test('38편 모두 변환 결과에 남은 기호 없음, 해시가 실행마다 같음', function() {
    var slugs = fs.readdirSync(path.join(h.REPO, 'posts')).filter(function(f) { return f.endsWith('.md'); }).map(function(f) { return f.replace(/\.md$/, ''); });
    assert.ok(slugs.length >= 38, '글 수: ' + slugs.length);
    slugs.forEach(function(slug) {
      var a = lt.loadPostTexts(h.REPO, slug, PRON);
      var b = lt.loadPostTexts(h.REPO, slug, PRON);
      assert.deepStrictEqual(lt.validateListenText(a.full), [], slug);
      ['|', '**', '![', 'http', '<', '](', '~', '%', '×', '→'].forEach(function(c) {
        assert.ok(a.full.indexOf(c) === -1, slug + ' 에 ' + c + ' 남음');
      });
      assert.strictEqual(lt.audioHash8(a.full, 'v', 1), lt.audioHash8(b.full, 'v', 1), slug + ' 해시가 다름');
      assert.ok(/^[0-9a-f]{8}$/.test(lt.audioHash8(a.full, 'v', 1)));
    });
  });

  t.test('해시는 음성·속도·텍스트가 바뀌면 달라짐', function() {
    var base = lt.audioHash8('가나다', 'ko-KR-Chirp3-HD-Kore', 1);
    assert.notStrictEqual(base, lt.audioHash8('가나다라', 'ko-KR-Chirp3-HD-Kore', 1));
    assert.notStrictEqual(base, lt.audioHash8('가나다', 'ko-KR-Neural2-A', 1));
    assert.notStrictEqual(base, lt.audioHash8('가나다', 'ko-KR-Chirp3-HD-Kore', 1.25));
  });

  t.test('요약 대본 변환: 앞뒤 인사 자동, 숫자 쉼표 제거', function() {
    var raw = fs.readFileSync(path.join(FIX, 'isa-summary.md'), 'utf-8');
    var out = lt.summaryListenText(raw, 'ISA 계좌 하나로 절세 끝내기', { pronunciations: PRON });
    assert.ok(out.startsWith('아이에스에이 계좌 하나로 절세 끝내기. 3분 요약입니다.'));
    assert.ok(out.endsWith('자세한 표와 계산은 파이낸셜 다이어리 글에서 확인하세요. 이 음성은 AI가 읽었습니다.'));
    has(out, '1000만 원');
    assert.deepStrictEqual(lt.validateListenText(out), []);
  });

  t.test('숫자 뽑기: 79만 2천 원 → 79만, 2천 / 1,000만 → 1000만 / 15.4%', function() {
    var tokens = cs.extractNumbers('79만 2천 원, 1,000만 원, 15.4%, 12개월, 3년').map(function(n) { return n.token; });
    assert.deepStrictEqual(tokens, ['79만', '2천', '1000만', '15.4%', '12개월', '3년']);
  });

  t.test('숫자 대조: 계획서 예시 대본은 ISA 글과 맞음(통과)', function() {
    var s = lt.parseFrontmatter(fs.readFileSync(path.join(FIX, 'isa-summary.md'), 'utf-8'));
    var p = lt.parseFrontmatter(fs.readFileSync(path.join(h.REPO, 'posts', '2026-isa-account-guide.md'), 'utf-8'));
    assert.deepStrictEqual(cs.missingNumbers(s.content, p.content), []);
  });

  t.test('숫자 대조: 틀린 숫자는 실패, 쉼표 차이(1,000만/1000만)는 통과', function() {
    var p = lt.parseFrontmatter(fs.readFileSync(path.join(h.REPO, 'posts', '2026-isa-account-guide.md'), 'utf-8'));
    assert.deepStrictEqual(cs.missingNumbers('순이익이 1,001만 원이면 155만 원을 냅니다. 16.4%입니다.', p.content), ['1001만', '155만', '16.4%']);
    assert.deepStrictEqual(cs.missingNumbers('순이익이 1000만 원이면 154만 원을 냅니다.', p.content), []);
    assert.deepStrictEqual(cs.missingNumbers('5000만 원 이하', p.content), []);
  });

  t.test('금지 형식 찾기', function() {
    var found = cs.forbiddenIn('**굵게** [링크](/a) https://x.com | 표 ![그림](a.png) 쿠팡 클릭');
    ['굵게(**)', '링크([글](주소))', '주소(http)', '표(|)', '그림(![)', '쿠팡', '"클릭"'].forEach(function(f) {
      assert.ok(found.indexOf(f) !== -1, f + ' 를 못 찾음: ' + found.join(', '));
    });
    assert.deepStrictEqual(cs.forbiddenIn('평범한 대본 문장입니다.'), []);
  });

  t.test('checkAll: 짝·길이·숫자·필수 시작일·경고', function() {
    var root = h.mirror('check');
    try {
      var good = fs.readFileSync(path.join(FIX, 'isa-summary.md'), 'utf-8');
      fs.mkdirSync(path.join(root, 'audio', '2026-isa-account-guide'), { recursive: true });
      fs.writeFileSync(path.join(root, 'audio', '2026-isa-account-guide', 'summary.md'), good);
      var res = cs.checkAll(root, { pronunciations: PRON });
      assert.ok(!cs.hasErrors(res.errors), cs.formatErrors(res.errors));
      assert.deepStrictEqual(res.warnings, []);

      // 고아 대본, post 값 틀림, 짧은 대본, 틀린 숫자
      fs.mkdirSync(path.join(root, 'audio', 'no-such-post'), { recursive: true });
      fs.writeFileSync(path.join(root, 'audio', 'no-such-post', 'summary.md'), good);
      fs.mkdirSync(path.join(root, 'audio', '2026-gold-investment-guide'), { recursive: true });
      fs.writeFileSync(path.join(root, 'audio', '2026-gold-investment-guide', 'summary.md'),
        '---\npost: wrong\nbasedOn: 2026-01-01\n---\n금은 짧습니다. 7,777만 원을 넣으세요.\n');
      res = cs.checkAll(root, { pronunciations: PRON, requiredFrom: '2026-10-01' });
      var text = cs.formatErrors(res.errors);
      assert.ok(/posts\/no-such-post\.md 글이 없습니다/.test(text), text);
      assert.ok(/post: 값\("wrong"\)이 폴더 이름과 다릅니다/.test(text), text);
      assert.ok(/700~1,200자/.test(text), text);
      assert.ok(/\[빌드 중단\] 요약 대본 숫자/.test(text) && /7777만/.test(text), text);
      // 2026-10-01 이후 글 중 대본 없는 글
      assert.ok(res.errors.required.length > 0, text);
      assert.ok(res.warnings.some(function(w) { return /2026-gold-investment-guide/.test(w); }), '수정일 경고 없음');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  t.test('TTS 요청 나누기: 조각마다 4,500바이트 이하, 내용 보존', function() {
    var text = lt.loadPostTexts(h.REPO, '2026-national-pension-claim-strategy', PRON).full;
    var chunks = gen.splitChunks(text);
    assert.ok(chunks.length >= 3, '조각 수 ' + chunks.length);
    chunks.forEach(function(c) { assert.ok(Buffer.byteLength(c) <= 4500, Buffer.byteLength(c)); });
    assert.strictEqual(chunks.join('\n\n').replace(/\s+/g, ''), text.replace(/\s+/g, ''));
    var long = gen.splitChunks('가'.repeat(4000));
    assert.ok(long.length === 3 && long.every(function(c) { return Buffer.byteLength(c) <= 4500; }));
  });
};
