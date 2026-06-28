import asyncio
import httpx

async def run_tests():
    print("=== Testing Standalone Backend Endpoints ===")
    
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8002", timeout=30.0) as client:
        print("\n1. Testing Root and Health Endpoints")
        resp = await client.get("/")
        print(f"Root: {resp.status_code} - {resp.text[:60].strip()}...")
        resp = await client.get("/health")
        print(f"Health: {resp.status_code} - {resp.json()}")
        
        print("\n2. Testing URL Scanning Endpoint (Safe White-list Target: naver.com)")
        payload = {"url": "https://naver.com", "enable_deep_scan": False}
        async with client.stream("POST", "/api/web/scan/url", json=payload) as response:
            print(f"Status Code: {response.status_code}")
            async for line in response.aiter_lines():
                if line:
                    print(f"Stream output: {line}")
                    
        print("\n3. Testing URL Scanning Endpoint (Levenshtein Spoofing Target: naver-account-secure.xyz)")
        payload = {"url": "https://naver-account-secure.xyz", "enable_deep_scan": False}
        async with client.stream("POST", "/api/web/scan/url", json=payload) as response:
            print(f"Status Code: {response.status_code}")
            async for line in response.aiter_lines():
                if line:
                    print(f"Stream output: {line}")

        print("\n4. Testing Text Scanning Endpoint (Smishing Text)")
        payload = {"text": "[국민건강보험] 건강검진 보고서가 발송되었습니다. 링크를 눌러 확인하세요."}
        async with client.stream("POST", "/api/web/scan/text", json=payload) as response:
            print(f"Status Code: {response.status_code}")
            async for line in response.aiter_lines():
                if line:
                    print(f"Stream output: {line}")

if __name__ == "__main__":
    asyncio.run(run_tests())


