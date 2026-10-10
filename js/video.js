/* 글 요약 영상(가벼운 삽입)
 * - 처음엔 우리 포스터 + 재생 버튼(유튜브 링크)만 있다. 유튜브에 아무 요청도 보내지 않는다.
 * - 누르면 그 자리를 youtube-nocookie iframe으로 바꾸고 바로 재생, 초점을 iframe으로 옮긴다.
 * - 이 스크립트가 없거나 실패하면 링크 그대로 유튜브 쇼츠로 이동한다.
 */
(function() {
  try {
    var links = document.querySelectorAll('.post-video .video-lite[data-video-id]');
    Array.prototype.forEach.call(links, function(link) {
      link.addEventListener('click', function(e) {
        var id = link.getAttribute('data-video-id') || '';
        if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return; // 이상하면 링크로 이동
        // 새 탭·창으로 열려는 클릭은 그대로 둔다
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button > 0) return;
        e.preventDefault();

        var title = link.getAttribute('data-video-title') || '요약 영상';
        var iframe = document.createElement('iframe');
        iframe.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&playsinline=1&rel=0';
        iframe.title = title;
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        iframe.setAttribute('tabindex', '0');
        link.parentNode.replaceChild(iframe, link);
        iframe.focus();

        if (typeof window.gtag === 'function') {
          window.gtag('event', 'video_play', { video_id: id, page_path: location.pathname });
        }
      });
    });
  } catch (err) {
    // 실패해도 링크로 동작한다
  }
})();
