---
name: bluem-page-update
description: 블루엠 홈페이지 프로젝트에서 페이지를 고치거나 새 페이지·새 언어를 추가할 때 쓰는 순서.
---
<!-- 원본: 블루엠 표준 하네스 v0.5.0 (media). 이 파일은 고치지 말고 원본에서 고친 뒤 다시 설치. -->

# 홈페이지 페이지 수정 순서

1. **읽기**: 프로젝트 `CLAUDE.md`(고객·금지 사항) → `harness/type-rules.md` 순서로 읽는다.
2. **자료 확인**: 고객 자료는 `_workspace/`에서 찾는다. 없는 내용은 지어내지 않고 "(확인 필요)"로 둔다.
3. **고치기**: 한 언어를 고치면 다른 언어 페이지도 같은 구조로 맞춘다. 번역은 "(번역 검수 필요)"로 알린다.
4. **새 페이지·새 언어**: `harness.config.json`의 `pages`·`languages`에 추가해야 검사와 스크린샷에 들어간다.
5. **검사**: `bash harness/checks/gate.sh`(빌드+검사) → `node harness/checks/screenshots.mjs`.
6. **눈으로 확인**: `_workspace/screenshots/`에서 휴대폰 화면부터 본다. 글자 넘침·겹침·가로 스크롤이 없어야 한다.
7. **보고**: 대표에게 바뀐 페이지, 확인할 스크린샷 2~3장, 남은 "(확인 필요)" 항목을 짧게 알린다.
8. **커밋·배포**: `bluem-commit-and-deploy` 순서를 따른다.
