-- 좋아요 버튼용 D1 스키마 (Cloudflare 대시보드 D1 → blog-likes → Console 에 붙여넣고 실행)
-- 여러 번 실행해도 안전하다.

-- 글별 좋아요 수
CREATE TABLE IF NOT EXISTS likes (
  slug  TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

-- 중복 방지용 하루 단위 기록. 원본 IP는 저장하지 않고 해시만 저장한다.
-- 30일이 지나면 Worker가 지운다.
CREATE TABLE IF NOT EXISTS like_log (
  slug    TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  day     TEXT NOT NULL,  -- UTC 기준 YYYY-MM-DD
  PRIMARY KEY (slug, ip_hash, day)
);

CREATE INDEX IF NOT EXISTS like_log_day ON like_log (day);
