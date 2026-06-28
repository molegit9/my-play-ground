import base64
import httpx
import json
import asyncio
from datetime import datetime
from bs4 import BeautifulSoup
import urllib.parse
from typing import AsyncGenerator, Optional
import tldextract
from playwright.async_api import Playwright, TimeoutError

from app.core.config import settings
from app.services.database import log_analysis, get_cached_analysis

# --- Levenshtein Distance Functions ---
def calculate_distance(a: str, b: str) -> int:
    if not a:
        return len(b) if b else 0
    if not b:
        return len(a)
    
    matrix = [[i] for i in range(len(b) + 1)]
    matrix[0] = [j for j in range(len(a) + 1)]
    
    for i in range(1, len(b) + 1):
        for j in range(1, len(a) + 1):
            if b[i-1] == a[j-1]:
                matrix[i].append(matrix[i-1][j-1])
            else:
                matrix[i].append(min(
                    matrix[i-1][j-1] + 1,  # substitution
                    matrix[i][j-1] + 1,    # insertion
                    matrix[i-1][j] + 1     # deletion
                ))
    return matrix[len(b)][len(a)]

def check_levenshtein(domain: str) -> dict:
    top_brands = ["apple.com", "naver.com", "google.com", "amazon.com", "github.com", "facebook.com", "netflix.com"]
    try:
        parts = domain.split('.')
        base_domain = domain
        if len(parts) > 2:
            base_domain = '.'.join(parts[-2:])
        
        for brand in top_brands:
            if base_domain == brand:
                return {"spoofed": False, "brand": brand, "exact_match": True}
            
            dist = calculate_distance(base_domain, brand)
            if 0 < dist <= 2:
                return {"spoofed": True, "brand": brand, "exact_match": False}
        
        return {"spoofed": False, "brand": None, "exact_match": False}
    except Exception as e:
        print(f"Levenshtein error: {e}")
        return {"spoofed": False, "brand": None, "exact_match": False}

# --- Core OSINT URL services ---
async def get_domain_age_rdap(domain: str) -> str:
    """
    [OSINT] RDAP API를 호출하여 도메인 생성일을 확인합니다.
    """
    parts = domain.split('.')
    if len(parts) > 2:
        domain = '.'.join(parts[-2:])
        
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            res = await client.get(f"https://rdap.org/domain/{domain}")
            
            if res.status_code == 200:
                data = res.json()
                for event in data.get("events", []):
                    if event.get("eventAction") == "registration":
                        reg_date_str = event.get("eventDate")
                        if reg_date_str:
                            reg_date = datetime.fromisoformat(reg_date_str.replace('Z', '+00:00'))
                            now = datetime.now(reg_date.tzinfo)
                            days_old = (now - reg_date).days
                            if days_old < 30:
                                return f"생성된 지 {days_old}일 밖에 안 된 신규(위험) 도메인!!"
                            else:
                                years = days_old // 365
                                return f"생성된 지 {years}년 이상 된 오래된 안전 도메인"
    except Exception as e:
        print(f"[RDAP] 도메인 수집 오류({domain}): {e}")
        pass
        
    return "도메인 생성일 정보 보안 처리됨 (수년 이상 된 일반 도메인일 확률 높음)"

async def check_url_virustotal(url: str) -> Optional[dict]:
    vt_api_key = settings.VIRUSTOTAL_API_KEY
    if not vt_api_key or vt_api_key == "YOUR_VIRUSTOTAL_API_KEY":
        return None

    url_id = base64.urlsafe_b64encode(url.encode()).decode().strip("=")
    headers = {"x-apikey": vt_api_key}
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://www.virustotal.com/api/v3/urls/{url_id}",
                headers=headers,
                timeout=5.0
            )
            
            if response.status_code == 200:
                data = response.json()
                stats = data.get("data", {}).get("attributes", {}).get("last_analysis_stats", {})
                malicious = stats.get("malicious", 0)
                suspicious = stats.get("suspicious", 0)
                
                return {
                    "status": "VT_DANGER" if (malicious > 0 or suspicious > 0) else "VT_SAFE",
                    "reason": f"VirusTotal의 {malicious + suspicious}개 엔진에서 이 링크를 위험요소로 감지했습니다." if (malicious > 0 or suspicious > 0) else "전문 보안 엔진(VirusTotal) 검사 결과, 이 링크는 안전한 것으로 확인되었습니다.",
                    "stats": stats
                }
    except Exception as e:
        print(f"VirusTotal request error: {e}")
    return None

async def inspect_url_static(url: str) -> dict:
    """Tier 1: 정적 DOM 분석"""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ["http", "https"]:
        return {"url": url, "error": "Invalid scheme"}
        
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=3.0) as client:
            response = await client.get(url)
            soup = BeautifulSoup(response.text, "html.parser")
            
            return {
                "original_url": url,
                "final_url": str(response.url),
                "is_redirected": url != str(response.url),
                "page_title": soup.title.string.strip() if soup.title and soup.title.string else "No Title",
                "has_password_field": bool(soup.find("input", {"type": "password"})),
                "has_login_form": bool(soup.find("form")),
            }
    except Exception as e:
        return {"original_url": url, "error": f"Failed: {str(e)}"}

# --- Playwright Browser Analysis ---
MAX_CONCURRENT_BROWSERS = 2
_loop_semaphores = {}

def get_browser_semaphore():
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.Semaphore(MAX_CONCURRENT_BROWSERS)
        
    if loop not in _loop_semaphores:
        _loop_semaphores[loop] = asyncio.Semaphore(MAX_CONCURRENT_BROWSERS)
    return _loop_semaphores[loop]

async def inspect_url_with_playwright(playwright: Playwright, url: str) -> dict:
    """Tier 2: Playwright 기반 동적 DOM 분석"""
    result = {
        "original_url": url,
        "final_url": url,
        "page_title": "",
        "has_password_field": False,
        "has_form": False,
        "has_hidden_form": False,
        "is_redirected": False,
        "error": None,
        "error_type": "unknown",
        "requested_urls": [],
        "external_requests": [],
        "redirect_chain": [],
        "external_links": [],
        "suspicious_keywords": [],
        "favicon_url": None,
        "meta_description": None
    }
    
    extracted_original = tldextract.extract(url)
    original_domain = f"{extracted_original.domain}.{extracted_original.suffix}" if extracted_original.suffix else extracted_original.domain
    
    browser = None
    context = None
    page = None
    
    sem = get_browser_semaphore()
    async with sem:
        try:
            browser = await playwright.chromium.launch(headless=True)
            context = await browser.new_context(
                ignore_https_errors=True,
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
                java_script_enabled=True,
                accept_downloads=False,
                permissions=[]
            )
            
            async def route_handler(route):
                if route.request.resource_type in ["image", "media", "font", "stylesheet"]:
                    await route.abort()
                else:
                    await route.continue_()
                    
            await context.route("**/*", route_handler)
            page = await context.new_page()
            
            page.on("dialog", lambda dialog: asyncio.ensure_future(dialog.dismiss()))
            
            def on_request(request):
                if request.resource_type in ["image", "media", "font", "stylesheet"]:
                    return
                req_url = request.url
                result["requested_urls"].append(req_url)
                
                extracted_req = tldextract.extract(req_url)
                req_domain = f"{extracted_req.domain}.{extracted_req.suffix}" if extracted_req.suffix else extracted_req.domain
                
                if req_domain and original_domain and req_domain != original_domain:
                    result["external_requests"].append(req_url)
                    
            page.on("request", on_request)
            
            def on_response(response):
                if response.status in [301, 302, 303, 307, 308]:
                    result["redirect_chain"].append({
                        "url": response.url,
                        "status": response.status
                    })
                    
            page.on("response", on_response)
            
            response = await page.goto(url, timeout=15000, wait_until="domcontentloaded")
            
            if response:
                result["final_url"] = page.url
                result["is_redirected"] = (url != page.url)
                result["page_title"] = await page.title()
                
                result["has_password_field"] = await page.locator("input[type='password']").count() > 0
                result["has_form"] = await page.locator("form").count() > 0
                result["has_hidden_form"] = await page.evaluate("""() => {
                    return Array.from(document.querySelectorAll('form')).some(f => {
                        const style = window.getComputedStyle(f);
                        return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || f.hasAttribute('hidden');
                    });
                }""")
                
                try:
                    links = await page.locator("a").evaluate_all("els => els.map(el => el.href)")
                    ext_links = []
                    for link in links:
                        if not link: continue
                        extracted_link = tldextract.extract(link)
                        link_domain = f"{extracted_link.domain}.{extracted_link.suffix}" if extracted_link.suffix else extracted_link.domain
                        if link_domain and link_domain != original_domain:
                            ext_links.append(link)
                    result["external_links"] = list(set(ext_links))
                except Exception:
                    result["external_links"] = []
                    
                try:
                    content = await page.content()
                    content_lower = content.lower()
                    target_keywords = ['verify your account', 'enter your password', 'suspended', '계정 확인', '비밀번호 입력', '본인인증']
                    result["suspicious_keywords"] = [kw for kw in target_keywords if kw in content_lower]
                except Exception:
                    pass
                    
                try:
                    favicon = await page.evaluate("document.querySelector('link[rel~=\"icon\"]')?.href")
                    if favicon:
                        result["favicon_url"] = favicon
                except Exception:
                    pass
                    
                try:
                    meta_desc = await page.evaluate("document.querySelector('meta[name=\"description\"]')?.content")
                    if meta_desc:
                        result["meta_description"] = meta_desc
                except Exception:
                    pass
    
        except TimeoutError:
            result["error"] = "Timeout exceeded (15s)"
            result["error_type"] = "timeout"
        except Exception as e:
            error_str = str(e).lower()
            result["error"] = str(e)
            if "timeout" in error_str:
                result["error_type"] = "timeout"
            elif "err_name_not_resolved" in error_str:
                result["error_type"] = "dns_failure"
            elif "ssl" in error_str or "certificate" in error_str:
                result["error_type"] = "ssl_error"
            else:
                result["error_type"] = "unknown"
        finally:
            if page:
                try: await page.close()
                except Exception: pass
            if context:
                try: await context.close()
                except Exception: pass
            if browser:
                try: await browser.close()
                except Exception: pass
                
    return result

def run_playwright_in_thread(url: str) -> dict:
    import sys
    import asyncio
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    async def _run():
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            return await inspect_url_with_playwright(p, url)
    return asyncio.run(_run())

def get_genai_client():
    from google import genai
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "YOUR_GEMINI_API_KEY":
        return genai.Client(api_key=settings.GEMINI_API_KEY)
    return None

# --- Main API Unified Pipeline Function ---
async def analyze_web_url(url: str, enable_deep_scan: bool = True) -> AsyncGenerator[str, None]:
    """
    [통합 백엔드 URL 검사 파이프라인]
    진행 과정(progress) 및 최종 판단 결과를 NDJSON 형태로 스트리밍합니다.
    """
    try:
        if not url:
            yield json.dumps({"status": "error", "message": "A valid URL is required."}) + "\n"
            return
            
        domain = url.split("//")[-1].split("/")[0]
        
        # 1. Levenshtein 기반 타이포스쿼팅 로직 (로컬 검증)
        brand_data = check_levenshtein(domain)
        is_spoofed = brand_data.get("spoofed", False)
        target_brand = brand_data.get("brand")
        is_exact_match = brand_data.get("exact_match", False)

        parts = domain.split('.')
        base_domain = domain
        if len(parts) > 2:
            base_domain = f"{parts[-2]}.{parts[-1]}"
            
        top_brands = ["apple.com", "naver.com", "google.com", "amazon.com", "github.com", "facebook.com", "netflix.com"]
        is_backend_exact_match = base_domain in top_brands
        brand_name = base_domain if is_backend_exact_match else target_brand
        
        public_hosting_domains = ["github.io", "vercel.app", "netlify.app"]
        is_public_hosting = any(domain == ph or domain.endswith("." + ph) for ph in public_hosting_domains)
        
        # 백마운트 즉시 판정 (공식 탑 브랜드 도메인 필터링)
        if (is_backend_exact_match or (is_exact_match and target_brand)) and not is_public_hosting:
            early_data = json.dumps({"safety_score": 100, "reason": f"[{brand_name}] 공식 홈페이지입니다. 안전하게 이용하세요. (로컬 검증 완료)"}, ensure_ascii=False)
            log_analysis("web_url", url, "100", f"[{brand_name}] 공식 도메인 즉시 인증", raw_data=json.dumps({"reason": "exact_match"}, ensure_ascii=False))
            yield json.dumps({"status": "success", "data": early_data}) + "\n"
            return
            
        # 2. SQLite 로컬 캐시 확인
        cached = get_cached_analysis(url)
        if cached:
            status_val = str(cached["status"])
            if not status_val.isdigit():
                if "SAFE" in status_val: status_val = "100"
                elif "WARNING" in status_val: status_val = "40"
                elif "DANGER" in status_val: status_val = "10"
                else: status_val = "50"
            cache_data = {"safety_score": int(status_val), "reason": cached["reason"]}
            yield json.dumps({"status": "success", "data": json.dumps(cache_data, ensure_ascii=False)}) + "\n"
            return

        # 3. 비동기 OSINT 정보 검색 시작
        yield json.dumps({"progress": "바이러스토탈 및 도메인 정보 검색 중... 🔍"}) + "\n"
        
        domain_age_task = asyncio.create_task(get_domain_age_rdap(domain))
        vt_task = asyncio.create_task(check_url_virustotal(url))
        
        domain_age, vt_result = await asyncio.gather(domain_age_task, vt_task)
        
        vt_info = "미확인 (기록 없거나 대기열 초과)"
        if vt_result:
            if vt_result.get("status") == "VT_DANGER":
                vt_info = "위험 (기존 보안 엔진 블랙리스트에 이미 감지된 악성 도메인!)"
                early_data = json.dumps({"safety_score": 10, "reason": "전문 보안 엔진(VirusTotal) 블랙리스트에 이미 감지된 악성 사이트입니다. 절대 접속하지 마세요! (빠른 차단)"}, ensure_ascii=False)
                log_analysis("web_url", url, "10", "전문 보안 엔진(VirusTotal)에서 차단됨", raw_data=json.dumps({"vt_findings": vt_result}, ensure_ascii=False))
                yield json.dumps({"status": "success", "data": early_data}) + "\n"
                return
            else:
                vt_info = "안전 (전문 보안 엔진 블랙리스트에 없음)"

        # 4. Deep Scan 실행 (선택 사항 또는 퍼블릭 호스팅 도메인)
        deep_scan_info = ""
        raw_data_dict = {}
        if vt_result:
            raw_data_dict["vt_findings"] = vt_result

        if enable_deep_scan or is_public_hosting:
            # 1단계: 정적 DOM 검사
            yield json.dumps({"progress": "🔍 정밀 분석 1단계 — 정적 HTML 검사 중..."}) + "\n"
            try:
                static_res = await inspect_url_static(url)
                raw_data_dict["static_findings"] = static_res
                static_str = json.dumps(static_res, ensure_ascii=False)
                
                static_flags = []
                if static_res.get("has_password_field"): static_flags.append("비밀번호 입력란 감지")
                if static_res.get("has_login_form"): static_flags.append("의심 폼 감지")
                if static_res.get("final_url") and static_res.get("final_url") != url: static_flags.append("리다이렉션 감지")
                static_summary = f"정적 검사 완료 ({'⚠️ ' + ', '.join(static_flags) if static_flags else '이상 없음'})"
                yield json.dumps({"progress": f"✅ {static_summary}"}) + "\n"
                
                # 2단계: Playwright 동적 검사
                yield json.dumps({"progress": "🕵️ 정밀 분석 2단계 — Playwright 가상 브라우저 실행 중... (수 초 소요)"}) + "\n"
                
                loop = asyncio.get_running_loop()
                dynamic_res = await loop.run_in_executor(None, run_playwright_in_thread, url)
                raw_data_dict["dynamic_findings"] = dynamic_res
                dynamic_str = json.dumps(dynamic_res, ensure_ascii=False)
                
                dyn_flags = []
                if dynamic_res.get("is_redirected"): dyn_flags.append("리다이렉션 감지")
                if dynamic_res.get("has_password_field"): dyn_flags.append("비밀번호 폼 감지")
                if dynamic_res.get("has_hidden_form"): dyn_flags.append("히든 폼 감지")
                dyn_summary = f"동적 검사 완료 ({'⚠️ ' + ', '.join(dyn_flags) if dyn_flags else '이상 없음'})"
                yield json.dumps({"progress": f"✅ {dyn_summary}"}) + "\n"
                
                deep_scan_info = f"""
                [정밀 분석 (Deep Scan) 결과]
                - 정적 DOM 검사 결과: {static_str}
                - 동적 샌드박스(Playwright) 실행 결과: {dynamic_str}
                """
            except Exception as ex:
                yield json.dumps({"progress": f"⚠️ 정밀 분석 중 오류 발생: {str(ex)[:50]}"}) + "\n"
                deep_scan_info = f"정밀 분석 실패: {ex}"

        # 5. Gemini AI를 활용한 종합 보안 판정
        yield json.dumps({"progress": "AI(LLM)가 정보를 받아 처리 중... 🤖"}) + "\n"
        
        target_str = target_brand if target_brand else "없음"
        is_https = "사용 중 (안전함)" if str(url).startswith("https://") else "미사용 - HTTP 기반의 암호화되지 않은 취약한 연결 (개인정보 탈취 위험 높음!)"
        
        prompt = f"""
        당신은 보안 취약계층(어르신, 학생 등)을 돕는 친절한 화이트해커 전문가입니다.
        '인증서 만료', 'XSS' 같은 어려운 기술 용어는 절대 쓰지 말고, 중학생도 이해할 수 있는 쉬운 비유와 일상어로 1~2문장으로 대답해야 합니다.
        
        대상 URL: {url}
        
        [사전 분석 메타데이터]
        - HTTPS 통신 보안 프로토콜 사용 여부: {is_https}
        - Levenshtein 타이포스쿼팅 탐지: {is_spoofed} (사칭 타겟: {target_str})
        - 도메인 나이(RDAP): {domain_age}
        - VirusTotal 보안 DB 감지 여부: {vt_info}
        {deep_scan_info}
        
        위 메타데이터와 시스템 컨텍스트를 파악하여, 이 사이트의 안전도 점수(0~100)를 평가하세요.
        100점은 '공식 사이트이며 완전히 안전함'을 뜻하고, 0점은 '심각한 사기/피싱 환경'을 의미합니다.
        만약 [정밀 분석] 결과에서 리다이렉션 변조, 악성 폼 렌더링, 특히 '히든 폼(has_hidden_form: true)'이 감지되었다면 사용자를 속이려는 악의적인 목적(투명 폼 등)이 매우 강하므로 점수를 0점 가까이 크게 낮추고, 이유에 투명/히든 폼의 위험성을 반드시 명시하세요.
        
        응답은 반드시 아래 JSON 형식으로만 반환하세요:
        {{"safety_score": 90, "reason": "이곳은 아이폰 공식 홈페이지입니다. 안심하고 쓰셔도 좋습니다."}}
        """
        
        client = get_genai_client()
        if client is None:
            yield json.dumps({"status": "error", "message": "Gemini API 키가 설정되지 않았습니다."}) + "\n"
            return
            
        from google.genai import types
        response = await client.aio.models.generate_content(
            model='gemini-3.1-flash-lite',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            )
        )
        
        try:
            res_data = json.loads(response.text)
            log_score = str(res_data.get("safety_score", 50))
            log_reason = res_data.get("reason", "")
            log_analysis("web_url", url, log_score, log_reason, raw_data=json.dumps(raw_data_dict, ensure_ascii=False))
        except Exception as db_e:
            print("DB 로그 저장 에러:", db_e)
            
        yield json.dumps({"status": "success", "data": response.text}) + "\n"
        
    except Exception as e:
        yield json.dumps({"status": "error", "message": str(e)}) + "\n"
