/*!
 * 광고비와 매출 사이의 관계 알아보기 — 서버 (Google Apps Script)
 * © 2026 티쳐무 · 모든 권리 보유 (오픈소스 라이선스 없음)
 * 학교 수업 목적으로만 이용해 주세요. 그 밖의 이용은 먼저 문의해 주세요.
 *
 * 「데이터 과학」 회귀 분석 모델 수업용. 오렌지3로 단순·다중 선형 회귀를 해 보고
 * 그 결과를 학습지에 적어 선생님께 제출한다.
 *
 * 하는 일
 *   doGet          학생 화면 / 교사 화면(?page=teacher) 을 내려 준다
 *   apiLookup      학번을 넣었을 때 — 처음인지, 비밀번호를 물어야 하는지 알려 준다
 *   apiRegister    처음 오는 학생이 이름과 비밀번호를 정한다 → 접속표
 *   apiLogin       계정이 있는 학생이 비밀번호로 들어온다 → 접속표
 *   apiChangePw    학생이 스스로 비밀번호를 바꾼다
 *   apiLogout      나가기 (공용 컴퓨터)
 *   apiSubmit      학생 답을 「학생결과」 시트에 한 줄로 저장 (학번 = 한 줄, 다시 내면 덮어씀)
 *   apiLoadMine    제출해 둔 답을 돌려준다 (이어서 하기)
 *   apiList        교사 암호가 맞으면 반 전체 제출 목록과 정답표를 돌려준다
 *   apiImage       교사 암호가 맞으면 드라이브에 둔 캡처 한 장을 돌려준다
 *   apiDelete      교사 암호가 맞으면 한 학생 줄과 캡처를 지운다
 *   apiResetPw     교사 암호가 맞으면 한 학생의 비밀번호를 초기화한다
 *
 * ⚠ 학생이 누구인지는 **접속표(token)** 로만 가린다. 화면이 보낸 학번·이름을 믿지 않는다 —
 *   그래야 친구의 학번을 아는 것만으로 남의 답을 가져갈 수 없다.
 * ⚠ 비밀번호는 솔트 + SHA-256 해시로만 저장한다. 선생님도 볼 수 없다(초기화만 할 수 있다).
 * ⚠ 정답표(ANSWER_KEY)는 이 파일에만 둔다. 학생 화면 코드에는 들어가지 않으므로
 *   학생이 소스를 열어 봐도 정답을 찾을 수 없다.
 * ⚠ 최상위 선언은 function·var 로만 쓴다 — 시험(tools/gas-load.js)이 이름을 긁어 꺼낸다.
 * ⚠ 시트에 쓸 때는 반드시 withLock_() 안에서 — 서른 명이 동시에 제출하면 줄이 겹친다.
 */
'use strict';

/* ── 선생님이 고치는 곳 ───────────────────────────────── */

/** 교사 화면 암호. 시트 메뉴 「교사 암호 정하기」로 바꾸면 그 값이 먼저 쓰인다. */
var TEACHER_PASSWORD = '바꿔주세요';

/** 학생 캡처를 담을 내 드라이브 폴더 이름 */
var IMAGE_FOLDER = '광고비와 매출 학습지 캡처';

/** 답안이 쌓이는 시트 이름 */
var SHEET_NAME = '학생결과';

/** 계정이 쌓이는 시트 이름 (숨김) */
var ACCOUNT_SHEET = '계정(비밀번호)';

/** 한 번 들어오면 몇 시간 동안 이어서 쓸 수 있나 */
var SESSION_HOURS = 12;

/**
 * 자동 채점 정답표. 이 줄을 지우면 그 문항은 채점하지 않는다.
 *   숫자  — ±1%(최소 ±0.011)까지 정답으로 본다
 *   글자  — 똑같아야 정답. 여러 답을 받으려면 ['TV', 'tv'] 처럼 적는다
 *   숫자 배열 — 어느 하나와 맞으면 정답 (예: MAPE 를 비율·백분율 두 가지로 받기)
 *
 * ⚠ 공개 저장소에 올린 판이라 **값을 비워 두었다.** 받는 법은 ANSWER_KEY 위 주석에 적었다.
 * ⚠ STEP 4(70%/30%) 지표는 넣지 않았다 — 오렌지3 의 「재현 가능한 샘플링」이 어떤 200개 중
 *   140개를 고르는지 우리 쪽에서 똑같이 만들 수 없어서, 값을 지어내는 대신 비워 두었다.
 *   서술형(광고비 제안)은 정답이 하나가 아니라 채점하지 않는다 — 모범답안은 README 에 있다.
 */
var ANSWER_KEY = {
  /* ⚠⚠ 이 판은 **정답표를 비워 두었습니다.**
   *
   * 이 저장소가 공개라 학생이 찾아볼 수 있기 때문입니다.
   * 비어 있어도 앱은 그대로 돌아가고 **자동 채점만 쉬는 상태**가 됩니다
   * (교사 화면의 「채점 문항 정답」이 0/0 으로 나옵니다).
   *
   * ★ 정답표와 서술형 답안지가 필요한 선생님은 enssam21@gmail.com 으로 연락해 주세요.
   *   받으신 값을 이 괄호 안에 그대로 붙여 넣으면 그때부터 채점됩니다.
   *
   * 채점 규칙 — 숫자는 ±1%(최소 ±0.011)까지, 글자는 똑같아야 정답.
   *   숫자를 배열로 적으면(예: [0.15, 15]) 어느 하나와 맞을 때 정답입니다.
   *   채점하고 싶지 않은 문항은 그 줄을 지우면 됩니다.
   *
   * 들어갈 자리(이름만 적어 둡니다. 값은 받으신 답안지를 보세요) —
   *   STEP 1  rows · role_TV · role_Radio · role_Newspaper · role_Sales
   *   STEP 2  r_* · sign_* · str_* · bestVar · bestR
   *   STEP 3  sl_<매체>_mse · _rmse · _mae · _mape · _r2   (매체 셋)
   *   3-(2)   sb0_<매체> · sb_<매체>                        [심화]
   *   STEP 4  mr_mse · mr_rmse · mr_mae · mr_mape · mr_r2
   *   4-(2)   b0 · b_TV · b_Radio · b_Newspaper            [심화]
   *
   * ⚠ 서술형(3-(3)·4-(3) 광고비 제안)과 4-(3)「생각이 바뀌었나」는 채점하지 않습니다 —
   *   정답이 하나가 아니라서입니다. 모범답안은 따로 드리는 서술형 답안지에 있습니다.
   * ⚠ 1-(1) 속성 개수는 Sales 를 세는지(4) 빼는지(3)에 따라 갈려 넣지 않았습니다.
   */
};

/* 1-(1) 속성 개수는 Sales 를 세는지(4) 빼는지(3) 에 따라 답이 갈려 정답표에 넣지 않았다.
   한 가지로 받기로 정했다면 ANSWER_KEY 에 cols: 4 처럼 더하면 된다. */


/* ── 화면 내려 주기 ───────────────────────────────────── */

/** index.html 의 템플릿이 include('css') 꼴로 다른 파일을 끼워 넣을 때 쓴다 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || '';
  var t = HtmlService.createTemplateFromFile('index');
  t.PAGE = page === 'teacher' ? 'teacher' : 'student';
  return t.evaluate()
    .setTitle('광고비와 매출 사이의 관계 알아보기')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 시트를 열면 생기는 메뉴 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('📈 광고비와 매출 학습지')
    .addItem('① 시트 준비하기', 'menuSetup')
    .addItem('② 교사 암호 정하기', 'menuPassword')
    .addSeparator()
    .addItem('제출 현황 보기', 'menuSummary')
    .addItem('비밀번호 초기화', 'menuResetPw')
    .addItem('앱 정보', 'menuAbout')
    .addToUi();
}


/* ── 시트 ─────────────────────────────────────────────── */

/** 「학생결과」 시트의 열 순서. 앞 네 개는 메타, 그다음은 문항, 마지막은 캡처 세 개. */
/* 「학생결과」 시트의 메타 열.
   ⚠⚠ **숫자로 박아 읽지 말 것** — `metaIdx_('제출 시각')` 을 쓴다.
     열을 하나 늘리면 그 뒤가 전부 한 칸씩 밀려, 학생 답이 엉뚱한 열에 들어가는데
     화면에서는 멀쩡해 보인다. (2026-10-26 에 상태·마지막 저장 두 열을 더하며 겪을 뻔했다) */
var META_COLS = ['학번', '이름', '상태', '제출 시각', '마지막 저장', '기기 번호'];
function metaIdx_(name) { return META_COLS.indexOf(name); }

/* 학생 한 줄의 상태 — 교사 화면이 이 글자로 가른다 */
var ST_DRAFT = '작성 중';        // 아직 제출하지 않음 (자동 저장만 들어온 상태)
var ST_SENT = '제출함';
var ST_EDITED = '제출 후 수정';  // 제출한 뒤에 또 고쳤다
var IMAGE_COLS = ['STEP 4 캡처'];

/** 「계정(비밀번호)」 시트의 열 순서 */
var ACCOUNT_COLS = ['학번', '이름', '비밀번호 해시', '솔트', '만든 시각', '접속표', '접속표 만료'];

/** 학생 화면과 똑같은 문항 목록 — [저장 키, 시트 머리글] */
function fieldList_() {
  var attrs = ['TV', 'Radio', 'Newspaper', 'Sales'];
  var xs = ['TV', 'Radio', 'Newspaper'];
  /* ⚠ 이름이 data.html 의 METRICS 와 글자까지 같아야 한다 — 시트 머리글이 여기서 나온다 */
  var metrics = [['mse', 'MSE'], ['rmse', 'RMSE'], ['mae', 'MAE'], ['mape', 'MAPE'], ['r2', 'R²']];
  var out = [['rows', '1-(1) 데이터 개수'], ['cols', '1-(1) 속성 개수']];
  attrs.forEach(function (a) { out.push(['role_' + a, '1-(2) ' + a + ' 변수 종류']); });
  /* 1-(3)「그렇게 정한 이유」는 2026-10-25 사용자 지시로 뺐다. 되살리려면 여기와
     data.html 의 FIELDS, cards.html 의 STEP 1 카드를 함께 고쳐야 한다. */
  xs.forEach(function (a) {
    out.push(['r_' + a, '2-(1) ' + a + ' 상관계수 r']);
    out.push(['sign_' + a, '2-(1) ' + a + ' 방향']);
    out.push(['str_' + a, '2-(1) ' + a + ' 정도']);
  });
  out.push(['bestVar', '2-(2) 가장 높은 상관관계 변수'], ['bestR', '2-(2) 그 상관계수']);
  /* 2-(3)「양·음의 상관관계 뜻」도 2026-10-25 사용자 지시로 뺐다. */

  /* ⚠ r 의 제곱은 앱이 셈해 보여 주는 값이라 문항이 아니다 (2026-10-26) */
  /* STEP 3 (1) 단순 선형 회귀 세 가지 */
  xs.forEach(function (a) {
    metrics.forEach(function (m) { out.push(['sl_' + a + '_' + m[0], '3-(1) ' + a + ' 모델 ' + m[1]]); });
  });
  /* 3-(2) [심화] 회귀계수와 절편 */
  xs.forEach(function (a) {
    out.push(['sb0_' + a, '3-(2) ' + a + ' 모델 절편']);
    out.push(['sb_' + a, '3-(2) ' + a + ' 모델 회귀계수']);
  });
  out.push(['adPlan1', '3-(3) 광고비 제안 (단순 회귀까지 보고)']);

  /* STEP 4 — 세 매체를 모두 쓰는 다중 선형 회귀 (평가 지표 + 회귀계수 + 절편) */
  metrics.forEach(function (m) { out.push(['mr_' + m[0], '4-(1) 다중 회귀 ' + m[1]]); });
  /* 4-(2) 는 STEP 3 과 같은 [심화] — 회귀계수와 절편 */
  xs.forEach(function (a) { out.push(['b_' + a, '4-(2) ' + a + ' 회귀계수']); });
  out.push(['b0', '4-(2) 절편(intercept)']);
  out.push(['adPlan', '4-(3) 광고비 제안 (다중 회귀까지 보고)'],
    ['planChanged', '4-(3) 생각이 바뀌었나']);
  /* STEP 5(기계학습 기반)는 다음 차시 앱으로 옮겼다 */
  return out;
}

function headerRow_() {
  return META_COLS
    .concat(fieldList_().map(function (f) { return f[1]; }))
    .concat(IMAGE_COLS);
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

/** 시트를 가져온다. 없으면 머리글까지 만들어 준다. */
function ensure_(name, head, hide) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  var made = false;
  if (!sh) { sh = ss.insertSheet(name); made = true; }
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (made && hide) sh.hideSheet();
  return sh;
}

function sheet_() { return ensure_(SHEET_NAME, headerRow_(), false); }
function accSheet_() { return ensure_(ACCOUNT_SHEET, ACCOUNT_COLS, true); }

function setupSheets() {
  var head = headerRow_();
  sheet_();
  accSheet_();
  return { ok: true, cols: head.length };
}

/** 시트 쓰기는 모두 이 안에서 — 동시에 제출해도 줄이 겹치지 않는다 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('지금 다른 학생이 저장하고 있어요. 잠시 뒤 다시 눌러 주세요.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function props_() { return PropertiesService.getDocumentProperties(); }

/** 지금 쓰는 교사 암호 — 메뉴로 정한 값이 있으면 그것, 없으면 이 파일의 상수 */
function teacherPassword_() {
  var v = props_().getProperty('teacherPw');
  return v ? v : TEACHER_PASSWORD;
}

function checkPw_(pw) {
  return String(pw || '') !== '' && String(pw) === teacherPassword_();
}

function norm_(v) { return String(v == null ? '' : v).trim(); }

/** 학번은 숫자 4~5자리 */
function normSid_(sid) {
  var s = String(sid == null ? '' : sid).replace(/\s/g, '');
  if (!/^[0-9]{4,5}$/.test(s)) return '';
  return s;
}

function normName_(name) {
  return String(name == null ? '' : name).replace(/\s+/g, '');
}

/** 이름을 홍*동 처럼 가린다 — 화면에는 「내 학번이 맞나」만 확인시킨다 */
function maskName_(name) {
  var n = normName_(name);
  if (n.length <= 1) return n;
  if (n.length === 2) return n.charAt(0) + '*';
  var mid = '';
  for (var i = 1; i < n.length - 1; i++) mid += '*';
  return n.charAt(0) + mid + n.charAt(n.length - 1);
}


/* ── 계정 (비밀번호는 해시로만 저장한다) ──────────────── */

function accRow_(sid) {
  var sh = accSheet_();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var vals = sh.getRange(2, 1, last - 1, ACCOUNT_COLS.length).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (normSid_(vals[i][0]) === sid) {
      return {
        row: i + 2, sid: sid, name: String(vals[i][1] || ''),
        hash: String(vals[i][2] || ''), salt: String(vals[i][3] || ''),
        made: vals[i][4], token: String(vals[i][5] || ''), exp: vals[i][6]
      };
    }
  }
  return null;
}

function makeSalt_() {
  var s = '';
  for (var i = 0; i < 4; i++) s += Math.random().toString(36).substring(2, 10);
  return s.substring(0, 24);
}

function hashPw_(pw, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    salt + '|' + pw, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < raw.length; i++) {
    var b = (raw[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function makeToken_() {
  return Utilities.getUuid().replace(/-/g, '');
}

function newExpiry_() {
  return new Date(new Date().getTime() + SESSION_HOURS * 3600 * 1000);
}

/** 학번을 넣었을 때 — 계정이 있는지, 비밀번호를 물어야 하는지 알려 준다 */
function apiLookup(sid) {
  try {
    sid = normSid_(sid);
    if (!sid) return { ok: false, msg: '학번은 숫자 4~5자리로 적어 주세요. (예: 20315)' };
    var a = accRow_(sid);
    if (!a) return { ok: true, state: 'new', sid: sid };
    /* 해시가 비어 있으면 선생님이 초기화해 둔 것 — 이름을 확인하고 새로 정하게 한다 */
    if (!a.hash) return { ok: true, state: 'reset', sid: sid, masked: maskName_(a.name) };
    return { ok: true, state: 'known', sid: sid, masked: maskName_(a.name) };
  } catch (err) {
    return { ok: false, msg: '서버에 이어지지 않았어요. 잠시 뒤 다시 해 주세요.' };
  }
}

/** 처음 오는 학생 — 이름과 비밀번호를 정한다 (초기화된 학생도 여기로 온다) */
function apiRegister(sid, name, pw) {
  try {
    sid = normSid_(sid);
    name = normName_(name);
    if (!sid) return { ok: false, msg: '학번은 숫자 4~5자리로 적어 주세요.' };
    if (name.length < 2) return { ok: false, msg: '이름을 두 글자 이상 적어 주세요.' };
    if (String(pw || '').length < 4) return { ok: false, msg: '비밀번호는 네 글자 이상으로 정해 주세요.' };

    /* 여러 학생이 같은 순간에 처음 등록하면 줄이 겹칠 수 있다 */
    return withLock_(function () {
      var sh = accSheet_();
      var a = accRow_(sid);
      var salt = makeSalt_();
      var hash = hashPw_(pw, salt);
      var token = makeToken_();
      var exp = newExpiry_();

      if (a && a.hash) {
        return { ok: false, state: 'known', msg: '이미 비밀번호가 있는 학번입니다. 비밀번호를 적어 주세요.' };
      }
      if (a) {
        /* 초기화된 계정 — 이름이 남아 있으면 맞춰야 한다 */
        if (normName_(a.name) && normName_(a.name) !== name) {
          return { ok: false, msg: '학번과 이름이 맞지 않습니다. 선생님께 말씀해 주세요.' };
        }
        sh.getRange(a.row, 1, 1, ACCOUNT_COLS.length)
          .setValues([[sid, name, hash, salt, new Date(), token, exp]]);
      } else {
        sh.appendRow([sid, name, hash, salt, new Date(), token, exp]);
      }
      return { ok: true, token: token, sid: sid, name: name };
    });
  } catch (err) {
    return { ok: false, msg: '저장하지 못했어요. 잠시 뒤 다시 해 주세요.' };
  }
}

/** 계정이 있는 학생 — 비밀번호로 들어온다 */
function apiLogin(sid, pw) {
  try {
    sid = normSid_(sid);
    if (!sid) return { ok: false, msg: '학번을 다시 확인해 주세요.' };
    var a = accRow_(sid);
    if (!a) return { ok: false, state: 'new', msg: '처음 오는 학번입니다. 이름과 비밀번호를 정해 주세요.' };
    if (!a.hash) return { ok: false, state: 'reset', msg: '비밀번호가 초기화되어 있습니다. 새로 정해 주세요.' };
    if (hashPw_(pw, a.salt) !== a.hash) return { ok: false, msg: '비밀번호가 맞지 않습니다.' };

    var token = makeToken_();
    accSheet_().getRange(a.row, 6, 1, 2).setValues([[token, newExpiry_()]]);
    return { ok: true, token: token, sid: sid, name: a.name };
  } catch (err) {
    return { ok: false, msg: '서버에 이어지지 않았어요. 잠시 뒤 다시 해 주세요.' };
  }
}

/** 학생이 스스로 비밀번호를 바꾼다 */
function apiChangePw(token, oldPw, newPw) {
  var me = auth_(token);
  if (!me.ok) return me;
  var a = accRow_(me.sid);
  if (!a || hashPw_(oldPw, a.salt) !== a.hash) {
    return { ok: false, msg: '지금 쓰는 비밀번호가 맞지 않습니다.' };
  }
  if (String(newPw || '').length < 4) return { ok: false, msg: '새 비밀번호는 네 글자 이상으로 정해 주세요.' };
  var salt = makeSalt_();
  accSheet_().getRange(a.row, 3, 1, 2).setValues([[hashPw_(newPw, salt), salt]]);
  return { ok: true };
}

/** 접속표가 누구 것인지 — 화면이 보낸 학번을 믿지 않고 늘 이것으로 가린다 */
function auth_(token) {
  token = String(token || '');
  if (!token) return { ok: false, expired: true, msg: '로그인이 풀렸습니다. 다시 들어와 주세요.' };
  var sh = accSheet_();
  var last = sh.getLastRow();
  if (last < 2) return { ok: false, expired: true, msg: '로그인이 풀렸습니다. 다시 들어와 주세요.' };
  var vals = sh.getRange(2, 1, last - 1, ACCOUNT_COLS.length).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][5] || '') === token) {
      var exp = vals[i][6];
      if (exp && new Date(exp).getTime() < new Date().getTime()) {
        return { ok: false, expired: true, msg: '로그인이 오래되어 풀렸습니다. 다시 들어와 주세요.' };
      }
      return { ok: true, row: i + 2, sid: normSid_(vals[i][0]), name: String(vals[i][1] || '') };
    }
  }
  return { ok: false, expired: true, msg: '로그인이 풀렸습니다. 다시 들어와 주세요.' };
}

/** 나가기 — 공용 컴퓨터에서 다음 학생이 이어 쓰지 못하게 접속표를 지운다 */
function apiLogout(token) {
  var me = auth_(token);
  if (me.ok) accSheet_().getRange(me.row, 6, 1, 2).setValues([['', '']]);
  return { ok: true };
}


/* ── 학생: 제출 ───────────────────────────────────────── */

/**
 * 학생 답을 저장한다. 누구인지는 **접속표**로만 가린다.
 *   apiSubmit(token, { clientId, data: {키: 값}, imgs: {img3: 'data:…' | 'keep' | ''} })
 * 같은 학번이면 그 줄을 최신 답으로 덮어쓴다(새 줄이 생기지 않는다).
 */
function apiSubmit(token, payload) {
  try {
    var me = auth_(token);
    if (!me.ok) return me;
    var p = payload || {};
    var sid = me.sid, sname = me.name;

    var fields = fieldList_();
    var data = p.data || {};
    var imgs = p.imgs || {};

    /* ★ 작성 중 저장(draft) — 학생 화면이 조용히 보내는 것이다 (2026-10-26).
       ⚠ **제출 시각을 건드리지 않는다.** 건드리면 자동 저장 한 번에 「제출함」이 되어
         선생님이 낸 학생과 안 낸 학생을 가릴 수 없다.
       ⚠ 캡처도 손대지 않는다 — 드라이브에 같은 그림을 30초마다 올릴 수는 없다. */
    var draft = p.draft === true;

    return withLock_(function () {
      var sh = sheet_();
      var found = findRow_(sh, sid);
      var rowNo = found ? found.row : sh.getLastRow() + 1;
      var prevImgs = found ? found.imgs : IMAGE_COLS.map(function () { return ''; });

      /* 캡처: 'keep' 이면 예전 파일을 그대로 두고, 새 그림이면 드라이브에 올리고 옛것은 버린다.
         ⚠ 열쇠는 머리글의 「STEP n 캡처」에서 뽑는다 — STEP 3 을 빼면서 i + 3 이 맞지 않게 되었다. */
      var imgCells = IMAGE_COLS.map(function (label, i) {
        if (draft) return prevImgs[i];           // 작성 중 저장은 캡처를 그대로 둔다
        var key = imgKey_(label);
        var v = imgs[key];
        if (v === 'keep') return prevImgs[i];
        if (!v) { trash_(prevImgs[i]); return ''; }
        var id = saveImage_(v, sid + '_' + sname + '_' + label + '.jpg');
        if (id && prevImgs[i] && prevImgs[i] !== id) trash_(prevImgs[i]);
        return id || prevImgs[i];
      });

      var now = new Date();
      var prevSent = found ? found.values[metaIdx_('제출 시각')] : '';
      var hadSent = !!prevSent;

      /* 제출 시각: 제출일 때만 지금으로. 작성 중 저장은 **있던 값을 그대로 옮겨 적는다.** */
      var sentAt = draft ? (hadSent ? prevSent : '') : now;
      var status = draft ? (hadSent ? ST_EDITED : ST_DRAFT) : ST_SENT;

      var row = [sid, sname, status, sentAt, now, norm_(p.clientId)]
        .concat(fields.map(function (f) { return data[f[0]] == null ? '' : data[f[0]]; }))
        .concat(imgCells);
      sh.getRange(rowNo, 1, 1, row.length).setValues([row]);
      return { ok: true, row: rowNo, at: now.getTime(), draft: draft };
    });
  } catch (err) {
    return { ok: false, msg: '제출하지 못했어요. 잠시 뒤 다시 눌러 주세요.' };
  }
}

/** 작성 중 저장 — 학생 화면이 조용히 부른다. apiSubmit 에 draft 를 세워 넘길 뿐이다.
    ⚠ 따로 둔 까닭: 학생 화면에서 draft 를 빠뜨려 제출로 들어가는 사고를 막는다. */
function apiSaveDraft(token, payload) {
  var p = payload || {};
  p.draft = true;
  p.imgs = {};
  return apiSubmit(token, p);
}

/** 「STEP 4 캡처」 → 'img4' */
function imgKey_(label) {
  var m = String(label).match(/STEP\s*(\d+)/);
  return m ? 'img' + m[1] : '';
}

/** 학번이 같은 줄을 찾는다 (학번 하나 = 한 줄) */
function findRow_(sh, sid) {
  var last = sh.getLastRow();
  if (last < 2) return null;
  var n = headerRow_().length;
  var vals = sh.getRange(2, 1, last - 1, n).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (normSid_(vals[i][0]) === sid) {
      var base = META_COLS.length + fieldList_().length;
      return {
        row: i + 2,
        values: vals[i],
        imgs: IMAGE_COLS.map(function (_, k) { return norm_(vals[i][base + k]); })
      };
    }
  }
  return null;
}

/** data:image/…;base64,… 를 드라이브에 올리고 파일 id 를 돌려준다 */
function saveImage_(dataUrl, name) {
  var m = String(dataUrl).match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) return '';
  var folder = imageFolder_();
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name);
  var file = folder.createFile(blob);
  return file.getId();
}

function imageFolder_() {
  var id = props_().getProperty('imageFolderId');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 지워졌으면 새로 만든다 */ }
  }
  var it = DriveApp.getFoldersByName(IMAGE_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(IMAGE_FOLDER);
  props_().setProperty('imageFolderId', folder.getId());
  return folder;
}

function trash_(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* 이미 없으면 넘어간다 */ }
}


/* ── 학생: 이어서 하기 ────────────────────────────────── */

/** 제출해 둔 답을 돌려준다. 접속표로 가리므로 남의 답은 나오지 않는다. */
function apiLoadMine(token) {
  try {
    var me = auth_(token);
    if (!me.ok) return me;
    var found = findRow_(sheet_(), me.sid);
    if (!found) return { ok: false, error: 'not_found' };

    var fields = fieldList_();
    var data = {};
    fields.forEach(function (f, i) {
      var v = found.values[META_COLS.length + i];
      data[f[0]] = v == null ? '' : String(v);
    });
    var imgs = {};
    found.imgs.forEach(function (id, i) { if (id) imgs[imgKey_(IMAGE_COLS[i])] = id; });
    var at = found.values[metaIdx_('마지막 저장')] || found.values[metaIdx_('제출 시각')];
    return { ok: true, data: data, imgFiles: imgs, updatedAt: at ? new Date(at).getTime() : null };
  } catch (err) {
    return { ok: false, msg: '불러오지 못했어요.' };
  }
}

/**
 * 학생이 이어서 할 때 자기 캡처를 다시 받아 간다.
 * 접속표가 가리키는 학생의 줄에 적힌 파일 번호여야만 내려 준다 — 남의 캡처는 가져갈 수 없다.
 */
function apiMyImage(token, fileId) {
  try {
    var me = auth_(token);
    if (!me.ok) return me;
    fileId = norm_(fileId);
    var found = findRow_(sheet_(), me.sid);
    if (!found || !fileId || found.imgs.indexOf(fileId) < 0) return { ok: false, error: 'not_found' };
    return { ok: true, dataUrl: imageDataUrl_(fileId) };
  } catch (err) {
    return { ok: false, error: 'server' };
  }
}

function imageDataUrl_(fileId) {
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}


/* ── 교사 ─────────────────────────────────────────────── */

/** 반 전체 제출 목록 + 정답표 */
function apiList(pw) {
  try {
    if (!checkPw_(pw)) return { ok: false, error: 'wrong_password' };
    var sh = sheet_();
    var last = sh.getLastRow();
    var fields = fieldList_();
    var rows = [];
    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, headerRow_().length).getValues();
      vals.forEach(function (v) {
        if (!norm_(v[0]) && !norm_(v[1])) return;
        var d = { sid: norm_(v[0]), sname: norm_(v[1]) };
        d.status = norm_(v[metaIdx_('상태')]) || ST_DRAFT;
        var sentAt = v[metaIdx_('제출 시각')];
        var savedAt = v[metaIdx_('마지막 저장')];
        d.submitAt = sentAt ? new Date(sentAt).getTime() : null;
        d.savedAt = savedAt ? new Date(savedAt).getTime() : null;
        /* 옛 이름 — 교사 화면이 「마지막 움직임」으로 쓴다 */
        d.updatedAt = d.savedAt || d.submitAt;
        fields.forEach(function (f, i) {
          var x = v[META_COLS.length + i];
          d[f[0]] = x == null ? '' : String(x);
        });
        d.imgs = {};
        var base = META_COLS.length + fields.length;
        for (var i = 0; i < IMAGE_COLS.length; i++) {
          var id = norm_(v[base + i]);
          if (id) d.imgs[imgKey_(IMAGE_COLS[i])] = id;
        }
        rows.push(d);
      });
    }
    return { ok: true, rows: rows, key: ANSWER_KEY };
  } catch (err) {
    return { ok: false, error: 'server', message: String(err && err.message ? err.message : err) };
  }
}

function apiImage(pw, fileId) {
  try {
    if (!checkPw_(pw)) return { ok: false, error: 'wrong_password' };
    return { ok: true, dataUrl: imageDataUrl_(norm_(fileId)) };
  } catch (err) {
    return { ok: false, error: 'server' };
  }
}

function apiDelete(pw, sid) {
  try {
    if (!checkPw_(pw)) return { ok: false, error: 'wrong_password' };
    sid = normSid_(sid);
    return withLock_(function () {
      var sh = sheet_();
      var found = findRow_(sh, sid);
      if (!found) return { ok: false, error: 'not_found' };
      found.imgs.forEach(trash_);
      sh.deleteRow(found.row);
      return { ok: true };
    });
  } catch (err) {
    return { ok: false, error: 'server', message: String(err && err.message ? err.message : err) };
  }
}

/**
 * 비밀번호 초기화 — 해시·솔트·접속표만 지우고 **이름과 답안은 그대로 둔다.**
 * 그 학생은 다음에 들어올 때 이름을 확인한 뒤 비밀번호를 새로 정한다.
 */
function apiResetPw(pw, sid) {
  try {
    if (!checkPw_(pw)) return { ok: false, error: 'wrong_password' };
    sid = normSid_(sid);
    var a = accRow_(sid);
    if (!a) return { ok: false, error: 'not_found' };
    accSheet_().getRange(a.row, 3, 1, 5).setValues([['', '', '', '', '']]);
    return { ok: true, name: a.name };
  } catch (err) {
    return { ok: false, error: 'server' };
  }
}


/* ── 시트 메뉴 ────────────────────────────────────────── */

function menuSetup() {
  var r = setupSheets();
  SpreadsheetApp.getUi().alert('시트 두 장을 준비했습니다.\n\n' +
    '· ' + SHEET_NAME + ' (채점용, ' + r.cols + '열)\n' +
    '· ' + ACCOUNT_SHEET + ' (숨김 — 비밀번호는 해시로만 저장되어 선생님도 볼 수 없습니다)\n\n' +
    '이제 ② 교사 암호를 정하고, Apps Script 편집기에서 배포 → 새 배포 → 웹 앱으로 배포하세요.');
}

function menuPassword() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('교사 암호 정하기',
    '교사 화면(주소 끝에 ?page=teacher)을 열 때 쓸 암호를 적어 주세요.\n학생이 짐작하기 어려운 값으로 정하세요.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var pw = norm_(res.getResponseText());
  if (pw.length < 4) { ui.alert('암호는 4글자 이상으로 정해 주세요.'); return; }
  props_().setProperty('teacherPw', pw);
  ui.alert('암호를 정했습니다. 이제 교사 화면에서 이 암호로 들어갈 수 있습니다.');
}

function menuResetPw() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('비밀번호 초기화',
    '비밀번호를 잊은 학생의 학번을 적어 주세요. (예: 20315)\n\n' +
    '초기화하면 그 학생은 다음에 들어올 때 이름을 확인한 뒤 비밀번호를 새로 정합니다.\n' +
    '적어 둔 답과 캡처는 그대로 남습니다.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var sid = normSid_(r.getResponseText());
  if (!sid) { ui.alert('학번은 숫자 4~5자리로 적어 주세요.'); return; }
  var res = apiResetPw(teacherPassword_(), sid);
  if (!res.ok) { ui.alert(sid + ' 학번의 계정이 없습니다.'); return; }
  ui.alert(sid + ' ' + res.name + ' 학생의 비밀번호를 초기화했습니다.\n' +
    '다음에 들어올 때 이름을 확인하고 새 비밀번호를 정하게 됩니다.');
}

/** 현황 요약 글 — 시험이 내용을 대조하므로 만드는 부분을 따로 떼어 두었다 */
function summaryText_() {
  var r = apiList(teacherPassword_());
  var rows = r.rows || [];
  if (!rows.length) return '아직 들어온 학생이 없습니다.';
  /* 제출한 학생과 아직 쓰고 있는 학생을 가른다 — 자동 저장이 들어오므로 둘이 섞인다 */
  var sent = rows.filter(function (d) { return d.status !== ST_DRAFT; });
  var lines = ['들어온 학생 ' + rows.length + '명 · 제출 ' + sent.length + '명 · ' +
    '작성 중 ' + (rows.length - sent.length) + '명', ''];
  var keyed = fieldList_().filter(function (f) { return f[0] in ANSWER_KEY; });
  rows.slice().sort(function (a, b) { return String(a.sid).localeCompare(String(b.sid), 'ko'); })
    .forEach(function (d) {
      var ok = keyed.filter(function (f) { return gradeOne_(f[0], d[f[0]]); }).length;
      var shots = Object.keys(d.imgs || {}).length;
      lines.push(d.sid + ' ' + d.sname + ' [' + d.status + '] — 채점 문항 ' + ok + '/' + keyed.length +
        ' · 캡처 ' + shots + '/' + IMAGE_COLS.length);
    });
  return lines.join('\n');
}

function menuSummary() {
  SpreadsheetApp.getUi().alert(summaryText_());
}

function menuAbout() {
  SpreadsheetApp.getUi().alert('광고비와 매출 사이의 관계 알아보기\n' +
    '© 2026 티쳐무 · 모든 권리 보유\n\n' +
    '학생 주소: 웹 앱 배포 주소\n' +
    '교사 화면: 그 주소 끝에 ?page=teacher\n\n' +
    '학생은 학번 → 이름·비밀번호 두 단계로 들어옵니다.\n' +
    '비밀번호는 솔트 + SHA-256 해시로만 저장되어 선생님도 볼 수 없습니다.\n' +
    '잊은 학생은 메뉴 「비밀번호 초기화」로 다시 정하게 하세요.\n\n' +
    '학번과 이름만 사용하며 그 밖의 개인정보는 받지 않습니다.');
}

/** 자동 채점 한 문항 — 교사 화면과 같은 규칙 (시트 메뉴 요약에서도 쓴다) */
function gradeOne_(key, v) {
  if (!(key in ANSWER_KEY)) return null;
  var ans = ANSWER_KEY[key];
  if (v == null || norm_(v) === '') return false;
  var list = Array.isArray(ans) ? ans : [ans];
  for (var i = 0; i < list.length; i++) {
    var a = list[i];
    if (typeof a === 'number') {
      var x = Number(v);
      if (isFinite(x) && Math.abs(x - a) <= Math.max(0.011, Math.abs(a) * 0.01)) return true;
    } else if (norm_(v) === String(a)) return true;
  }
  return false;
}
