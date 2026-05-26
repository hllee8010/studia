// ══════════════════════════════════════════════════════════════════
//  portone-billing.js — 스터디아 포트원 V2 정기결제 연동
//
//  사용법: app.html <head> 끝 부분에 다음 두 줄 추가:
//    <script src="https://cdn.portone.io/v2/browser-sdk.js"></script>
//    <script src="portone-billing.js"></script>
//
//  이 파일이 하는 일:
//   1) #billingRegBtn 클릭 시 PG 선택 모달 표시 (카카오페이 / 카드)
//   2) 포트원 V2 SDK로 빌링키 발급
//   3) Supabase Edge Function (portone-billing/save-key) 호출해 저장
//   4) 성공 시 홈 화면으로 이동
//   5) #menuSubscription 클릭 시 구독 관리 모달 표시 + 해지 처리
// ══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // 설정값 (app.html의 기존 변수와 공유)
  // ──────────────────────────────────────────────
  var PORTONE_STORE_ID = 'store-d8b48872-c1df-440f-a0c7-ef901e7510c9';

  var CHANNEL_KEYS = {
    KAKAO_PAY: 'channel-key-9e8508b4-d9f7-43d4-a222-d4bd1894f04f',
    KG_INICIS: 'channel-key-fd193b13-8fdb-4e74-916b-7cd313117d1b',
    NHN_KCP:   'channel-key-0eef4522-e318-4c3b-98e2-b683239f3a18',
  };

  // Edge Function URL (app.html의 SUPABASE_URL 변수 활용)
  function getBillingFnUrl(action) {
    var base = (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '')
      + '/functions/v1/portone-billing/' + action;
    return base;
  }

  // Supabase 세션 토큰 가져오기
  async function getAuthToken() {
    if (typeof sb === 'undefined' || !sb) throw new Error('Supabase 클라이언트 없음');
    var { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('로그인 필요');
    return session.access_token;
  }

  // ──────────────────────────────────────────────
  // PG 선택 모달 HTML (카카오페이 / 카드 직접 입력)
  // ──────────────────────────────────────────────
  function createPgSelectModal() {
    var overlay = document.createElement('div');
    overlay.id = 'portone-pg-modal';
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,0.5);',
      'z-index:9999;display:flex;align-items:flex-end;justify-content:center;',
    ].join('');

    overlay.innerHTML = [
      '<div style="background:#fff;border-radius:20px 20px 0 0;padding:28px 24px 36px;',
        'width:100%;max-width:480px;box-shadow:0 -4px 24px rgba(0,0,0,0.12);">',
        '<h3 style="margin:0 0 8px;font-size:1.15rem;font-weight:700;color:#1a2a4a;">',
          '결제수단을 선택해주세요</h3>',
        '<p style="margin:0 0 20px;font-size:0.85rem;color:#666;">',
          '7일 무료체험 후 월 18,900원이 자동 청구됩니다.</p>',

        // 카카오페이
        '<button id="pg-kakao" style="',
          'width:100%;padding:16px;margin-bottom:10px;border:2px solid #FEE500;',
          'background:#FEE500;border-radius:12px;cursor:pointer;font-size:1rem;',
          'font-weight:600;color:#3A1D1D;display:flex;align-items:center;gap:12px;">',
          '<span style="font-size:1.4rem;">💛</span>',
          '<span>카카오페이로 등록</span>',
        '</button>',

        // 카드 직접 입력
        '<button id="pg-card" style="',
          'width:100%;padding:16px;margin-bottom:10px;border:2px solid #e8edf5;',
          'background:#fff;border-radius:12px;cursor:pointer;font-size:1rem;',
          'font-weight:600;color:#1a2a4a;display:flex;align-items:center;gap:12px;">',
          '<span style="font-size:1.4rem;">💳</span>',
          '<span>신용·체크카드 직접 입력</span>',
        '</button>',

        '<button id="pg-cancel" style="',
          'width:100%;padding:12px;border:none;background:none;',
          'cursor:pointer;font-size:0.9rem;color:#888;margin-top:4px;">',
          '취소</button>',
      '</div>',
    ].join('');

    return overlay;
  }

  // ──────────────────────────────────────────────
  // 빌링키 발급 메인 함수
  // ──────────────────────────────────────────────
  async function issueBillingKey(pgProvider) {
    if (typeof PortOne === 'undefined') {
      alert('결제 모듈 로드 중입니다. 잠시 후 다시 시도해주세요.');
      return null;
    }

    var token = await getAuthToken();
    var { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('유저 정보 없음');

    // 포트원 빌링키 발급 요청
    var issueResponse = await PortOne.requestIssueBillingKey({
      storeId:   PORTONE_STORE_ID,
      channelKey: CHANNEL_KEYS[pgProvider],
      billingKeyMethod: pgProvider === 'KAKAO_PAY' ? 'EASY_PAY' : 'CARD',
      issueId:   'studia-bk-' + user.id + '-' + Date.now(),
      issueName: 'Studia 월 구독 결제수단',
      customer: {
        customerId: user.id,
        email:      user.email || '',
        fullName:   user.user_metadata?.name || user.user_metadata?.full_name || 'Studia 사용자',
      },
      easyPay: pgProvider === 'KAKAO_PAY' ? { easyPayProvider: 'KAKAOPAY' } : undefined,
    });

    if (issueResponse.code) {
      // 에러 코드가 있으면 사용자가 취소하거나 실패
      if (issueResponse.code !== 'USER_CANCEL') {
        console.error('[portone] 빌링키 발급 실패:', issueResponse);
        throw new Error(issueResponse.message || '빌링키 발급에 실패했습니다.');
      }
      return null; // 사용자 취소
    }

    return {
      billingKey: issueResponse.billingKey,
      pgProvider: pgProvider,
      token: token,
    };
  }

  // ──────────────────────────────────────────────
  // Edge Function에 빌링키 저장
  // ──────────────────────────────────────────────
  async function saveBillingKeyToServer(billingKey, pgProvider, token) {
    var res = await fetch(getBillingFnUrl('save-key'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ billingKey: billingKey, pgProvider: pgProvider }),
    });
    var data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || '서버 저장 실패');
    }
    return data;
  }

  // ──────────────────────────────────────────────
  // 로딩 오버레이
  // ──────────────────────────────────────────────
  function showLoading(msg) {
    var el = document.getElementById('portone-loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'portone-loading';
      el.style.cssText = [
        'position:fixed;inset:0;background:rgba(255,255,255,0.9);',
        'z-index:10000;display:flex;flex-direction:column;',
        'align-items:center;justify-content:center;gap:16px;',
      ].join('');
      document.body.appendChild(el);
    }
    el.innerHTML = [
      '<div style="width:40px;height:40px;border:4px solid #e8edf5;',
        'border-top-color:#3b6bcc;border-radius:50%;animation:spin 0.8s linear infinite;"></div>',
      '<p style="font-size:0.95rem;color:#1a2a4a;font-weight:500;">' + (msg || '처리 중...') + '</p>',
      '<style>@keyframes spin{to{transform:rotate(360deg)}}</style>',
    ].join('');
    el.style.display = 'flex';
  }

  function hideLoading() {
    var el = document.getElementById('portone-loading');
    if (el) el.style.display = 'none';
  }

  // ──────────────────────────────────────────────
  // 전체 카드 등록 플로우
  // ──────────────────────────────────────────────
  async function runBillingFlow(pgProvider) {
    showLoading('결제창 여는 중...');
    try {
      var result = await issueBillingKey(pgProvider);
      if (!result) {
        hideLoading();
        return; // 취소됨
      }

      showLoading('카드 정보 저장 중...');
      await saveBillingKeyToServer(result.billingKey, result.pgProvider, result.token);

      hideLoading();

      // 성공 → 홈 화면으로 이동
      alert('카드 등록이 완료됐어요!\n7일 무료체험이 시작됩니다. 🎉');
      if (typeof showScreen === 'function') {
        showScreen('screenHome');
      }
      // 페이지 새로고침으로 구독 상태 반영
      setTimeout(function () { window.location.reload(); }, 300);

    } catch (err) {
      hideLoading();
      console.error('[portone] 오류:', err);
      alert('오류가 발생했어요: ' + (err.message || '알 수 없는 오류'));
    }
  }

  // ──────────────────────────────────────────────
  // 카드 등록 버튼 핸들러 (billingRegBtn)
  // ──────────────────────────────────────────────
  function attachBillingButton() {
    var regBtn = document.getElementById('billingRegBtn');
    if (!regBtn) return;

    regBtn.addEventListener('click', function () {
      // 기존 stub 동작 제거 방지를 위해 이벤트 캡처
      var modal = createPgSelectModal();
      document.body.appendChild(modal);

      // 카카오페이 선택
      document.getElementById('pg-kakao').addEventListener('click', function () {
        document.body.removeChild(modal);
        runBillingFlow('KAKAO_PAY');
      });

      // 카드 직접 입력 선택 (KCP 사용)
      document.getElementById('pg-card').addEventListener('click', function () {
        document.body.removeChild(modal);
        runBillingFlow('NHN_KCP');
      });

      // 취소
      document.getElementById('pg-cancel').addEventListener('click', function () {
        document.body.removeChild(modal);
      });

      // 배경 클릭 시 닫기
      modal.addEventListener('click', function (e) {
        if (e.target === modal) document.body.removeChild(modal);
      });
    });
  }

  // ──────────────────────────────────────────────
  // 구독 해지 핸들러 (menuSubscription)
  // ──────────────────────────────────────────────
  function attachCancelButton() {
    var menuBtn = document.getElementById('menuSubscription');
    if (!menuBtn) return;

    menuBtn.addEventListener('click', async function () {
      var confirmed = confirm(
        '구독을 해지하시겠어요?\n\n' +
        '해지해도 남은 체험/구독 기간이 끝날 때까지 계속 이용할 수 있어요.'
      );
      if (!confirmed) return;

      showLoading('해지 처리 중...');
      try {
        var token = await getAuthToken();
        var res = await fetch(getBillingFnUrl('cancel'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
          },
          body: JSON.stringify({}),
        });
        var data = await res.json();
        hideLoading();

        if (data.error === 'too_early_to_cancel') {
          alert('체험 5일차부터 해지할 수 있어요.\n조금 더 사용해보세요! 😊');
          return;
        }
        if (!res.ok || !data.success) {
          throw new Error(data.error || '해지 처리 실패');
        }

        alert('해지가 완료됐어요.\n남은 기간 동안 계속 이용할 수 있어요.');
        setTimeout(function () { window.location.reload(); }, 300);

      } catch (err) {
        hideLoading();
        alert('오류가 발생했어요: ' + (err.message || '알 수 없는 오류'));
      }
    });
  }

  // ──────────────────────────────────────────────
  // 약관·개인정보 링크 핸들러
  // ──────────────────────────────────────────────
  function attachLegalLinks() {
    var openTerms   = document.getElementById('billingOpenTerms');
    var openPrivacy = document.getElementById('billingOpenPrivacy');
    if (openTerms)   openTerms.addEventListener('click',   function(){try{document.getElementById('setupOpenTerms').click();}catch(e){}});
    if (openPrivacy) openPrivacy.addEventListener('click', function(){try{document.getElementById('setupOpenPrivacy').click();}catch(e){}});
  }

  // ──────────────────────────────────────────────
  // #billing 해시로 직접 접근 시 화면 이동
  // ──────────────────────────────────────────────
  function handleBillingHash() {
    try {
      if (window.location.hash === '#billing') {
        setTimeout(function () {
          if (typeof showScreen === 'function') showScreen('screenBilling');
        }, 500);
      }
    } catch (e) {}
  }

  // ──────────────────────────────────────────────
  // 초기화 — DOM 로드 완료 후 실행
  // ──────────────────────────────────────────────
  function init() {
    attachBillingButton();
    attachCancelButton();
    attachLegalLinks();
    handleBillingHash();
    console.log('[portone-billing] 초기화 완료');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
