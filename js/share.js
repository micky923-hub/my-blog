(function() {
  var section = document.querySelector('.share-section');
  if (!section) return;

  var url = section.getAttribute('data-url');
  var title = section.getAttribute('data-title');
  var desc = section.getAttribute('data-desc');
  var image = section.getAttribute('data-image');

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
  }

  function showCopied(label) {
    label.textContent = '복사됨!';
    setTimeout(function() { label.textContent = 'URL 복사'; }, 2000);
  }

  section.querySelector('[data-share="url"]').addEventListener('click', function() {
    var label = this.querySelector('.share-label');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function() {
        showCopied(label);
      }).catch(function() {
        fallbackCopy(url);
        showCopied(label);
      });
    } else {
      fallbackCopy(url);
      showCopied(label);
    }
  });

  section.querySelector('[data-share="kakao"]').addEventListener('click', function() {
    if (typeof Kakao !== 'undefined' && Kakao.isInitialized()) {
      Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title: title,
          description: desc,
          imageUrl: image,
          link: { mobileWebUrl: url, webUrl: url }
        },
        buttons: [
          { title: '글 읽기', link: { mobileWebUrl: url, webUrl: url } }
        ]
      });
    } else if (navigator.share) {
      navigator.share({ title: title, text: desc, url: url });
    }
  });

  section.querySelector('[data-share="facebook"]').addEventListener('click', function() {
    window.open(
      'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url),
      '_blank',
      'width=600,height=400'
    );
  });

  section.querySelector('[data-share="x"]').addEventListener('click', function() {
    window.open(
      'https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(title),
      '_blank',
      'width=600,height=400'
    );
  });
})();
