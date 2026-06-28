import os
import json
import asyncio
import pandas as pd
import chromadb
from chromadb.utils import embedding_functions
from tqdm import tqdm
from typing import AsyncGenerator
from google import genai
from google.genai import types

from app.core.config import settings
from app.services.database import log_analysis

collection = None

def init_vector_db(csv_path: str = None, sample_size: int = 10000):
    global collection
    db_path = settings.CHROMA_DB_PATH

    # Determine CSV dataset paths to load
    csv_paths = []
    if csv_path is not None:
        csv_paths = [csv_path]
    else:
        csv_paths = settings.get_rag_dataset_paths()

    # Filter out non-existent files
    valid_csv_paths = [path for path in csv_paths if os.path.exists(path)]
    if not valid_csv_paths:
        print(f"Error: No valid datasets found in {csv_paths}. Skipping vector DB init.")
        return

    print(f"[1/4] Loading datasets from {valid_csv_paths}...")
    try:
        dfs = []
        for path in valid_csv_paths:
            df_temp = pd.read_csv(path)
            
            # Standardize columns: 'text' -> 'content', 'phishing_type' -> 'source'
            if 'content' not in df_temp.columns and 'text' in df_temp.columns:
                df_temp = df_temp.rename(columns={'text': 'content'})
            
            if 'source' not in df_temp.columns and 'phishing_type' in df_temp.columns:
                df_temp = df_temp.rename(columns={'phishing_type': 'source'})
            elif 'source' not in df_temp.columns:
                df_temp['source'] = os.path.basename(path)
            
            # Drop null content
            df_temp = df_temp.dropna(subset=['content'])
            dfs.append(df_temp)
            print(f"[Info] Loaded {len(df_temp)} rows from {path}")

        if not dfs:
            print("Error: No data loaded. Skipping vector DB init.")
            return

        df = pd.concat(dfs, ignore_index=True)
        print(f"[Info] Total combined rows: {len(df)}")

        # Stratified sampling across label and source to ensure fair representation
        if len(df) > sample_size:
            print(f"[Info] Drawing a stratified sample of {sample_size} records...")
            groups = df.groupby(['label', 'source'])
            num_groups = groups.ngroups
            samples_per_group = max(1, sample_size // num_groups)
            
            sampled_indices = []
            for _, group in groups:
                sampled_indices.extend(group.sample(min(len(group), samples_per_group), random_state=42).index)
                
            df = df.loc[sampled_indices].reset_index(drop=True)
            print(f"[Info] Final sample size: {len(df)}")

        print("[2/4] Initializing Korean Embedding Model and ChromaDB...")
        # Local SentenceTransformer loading using ko-sroberta
        emb_fn = embedding_functions.SentenceTransformerEmbeddingFunction(model_name="jhgan/ko-sroberta-multitask")
        
        client = chromadb.PersistentClient(path=db_path)
        collection = client.get_or_create_collection(name="security_texts", embedding_function=emb_fn)

        # Check if database has already been initialized
        is_initialized = False
        if collection.count() > 0:
            if csv_path is not None:
                is_initialized = True
            else:
                try:
                    res = collection.get(where={"label": "0"}, limit=1)
                    if res and res.get("ids"):
                        is_initialized = True
                except Exception as e:
                    print(f"[Warning] Failed to verify DB contents: {e}")

        if is_initialized:
            print(f"[3/4] Database already initialized! Skipping embedding. (Count: {collection.count()})")
            print(f"[4/4] Vector Database successfully loaded at {db_path}")
            return

        print("[Info] Re-initializing vector database to include all datasets...")
        try:
            client.delete_collection(name="security_texts")
        except Exception:
            pass
        collection = client.get_or_create_collection(name="security_texts", embedding_function=emb_fn)

        print("[3/4] Vectorizing texts into the database (this might take a few minutes)...")
        batch_size = 500
        total_batches = (len(df) // batch_size) + 1

        for i in range(total_batches):
            batch_df = df.iloc[i * batch_size : (i + 1) * batch_size]
            if batch_df.empty:
                break
            
            documents = batch_df['content'].astype(str).tolist()
            
            metadatas = []
            for _, row in batch_df.iterrows():
                meta = {
                    "label": str(row['label']),
                    "source": str(row.get('source', 'unknown')),
                }
                if 'severity' in row and pd.notna(row['severity']):
                    meta['severity'] = str(row['severity'])
                if 'confidence' in row and pd.notna(row['confidence']):
                    meta['confidence'] = str(row['confidence'])
                metadatas.append(meta)
                
            ids = [f"doc_{idx}" for idx in batch_df.index]
            
            collection.upsert(
                documents=documents,
                metadatas=metadatas,
                ids=ids
            )

        print(f"[4/4] Vector Database successfully initialized at {db_path}")
        print(f"Total documents inside DB: {collection.count()}")
    except Exception as e:
        print(f"Vector DB init error: {e}")

async def query_rag_with_meta(text: str, n_results: int = 3) -> list[dict]:
    global collection
    if collection is None:
        return []

    try:
        results = collection.query(
            query_texts=[text],
            n_results=n_results,
            include=["documents", "metadatas", "distances"],
        )
        if not (results and "documents" in results and results["documents"]):
            return []

        docs      = results["documents"][0]
        metas     = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        enriched = []
        for i, doc in enumerate(docs):
            meta = metas[i] if i < len(metas) else {}
            dist = distances[i] if i < len(distances) else 1.0
            enriched.append({
                "document": doc,
                "label":    str(meta.get("label", "unknown")),
                "source":   str(meta.get("source", "unknown")),
                "distance": round(float(dist), 4),
            })
        return enriched
    except Exception as e:
        print(f"RAG Query Error: {e}")
        return []

def get_genai_client():
    if settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "YOUR_GEMINI_API_KEY":
        return genai.Client(api_key=settings.GEMINI_API_KEY)
    return None

async def analyze_web_text(text: str) -> AsyncGenerator[str, None]:
    """
    [웹 텍스트 RAG + Gemini 위협 분석 엔진]
    ChromaDB 컬렉션 쿼리를 수행하고, 검색된 과거 판결 컨텍스트를 조합하여 
    Gemini-3.1-flash-lite로 사회공학적 피싱 의도를 최종 분석합니다.
    """
    try:
        if not text:
            yield json.dumps({"risk_level": "에러", "score": 50, "reason": "분석할 텍스트가 입력되지 않았습니다.", "mitigation": "-"}) + "\n"
            return

        yield json.dumps({"progress": "과거 사례 검색 중... 🔍"}) + "\n"
        
        retrieved_context = ""
        highest_sim_info = ""
        
        if collection is not None:
            # Query vector database
            results = collection.query(query_texts=[text], n_results=3)
            
            if results and "documents" in results and len(results["documents"]) > 0 and len(results["documents"][0]) > 0:
                docs = results["documents"][0]
                metas = results["metadatas"][0]
                distances = results.get("distances", [[999]])[0]
                
                if len(distances) > 0:
                    sim_pct = max(0, min(100, int((1 - distances[0]) * 100)))
                    top_label = str(metas[0].get("label", "unknown"))
                    label_name = "알 수 없음"
                    if top_label == "2": label_name = "악성 피싱 판례"
                    elif top_label in ["1", "3"]: label_name = "안전 문구 판례"
                    elif top_label in ["4", "5"]: label_name = "악성 스팸 판례"
                    else: label_name = f"라벨 {top_label}"
                    
                    highest_sim_info = f"<br><br>💡 참고:  기존에 축적된 과거 신고 사례 중 가장 유사한 내용은 [{label_name}] (유사도 {sim_pct}%) 입니다."

                # 1차 초정밀 매치 (유사도 백분율 85% 이상 / distance 0.15 이하 시 Fast pass)
                if len(distances) > 0 and distances[0] < 0.15:
                    best_label = str(metas[0].get("label", "0"))
                    raw_data_dict = {"rag_match": True, "distance": distances[0], "metadata": metas[0]}
                    raw_str = json.dumps(raw_data_dict, ensure_ascii=False)
                    
                    if best_label == "2":
                        reason_msg = "이미 신고 및 검증이 완료된 악성 사기 문구와 완전히 일치하여, 추가 분석 없이 즉시 차단했습니다."
                        log_analysis("web_text", text, "5", reason_msg, raw_str)
                        yield json.dumps({"risk_level": "위험", "score": 95, "reason": reason_msg, "mitigation": "절대로 링크를 클릭하지 마세요."}) + "\n"
                        return
                    elif best_label in ["1", "3"]:
                        reason_msg = "확인된 안전 문구와 완전히 일치하여 실시간 확인 과정을 생략하고 통과시킵니다."
                        log_analysis("web_text", text, "95", reason_msg, raw_str)
                        yield json.dumps({"risk_level": "안전", "score": 5, "reason": reason_msg, "mitigation": "안심하세요."}) + "\n"
                        return
                    elif best_label in ["4", "5"]:
                        reason_msg = "스팸 및 광고성 메시지로 분류된 기존 사례와 내용이 완전히 동일하여 즉시 차단되었습니다."
                        log_analysis("web_text", text, "15", reason_msg, raw_str)
                        yield json.dumps({"risk_level": "위험", "score": 85, "reason": reason_msg, "mitigation": "즉시 삭제하세요."}) + "\n"
                        return

                context_pieces = []
                for i, doc in enumerate(docs):
                    label = metas[i].get("label", "unknown")
                    source = metas[i].get("source", "unknown")
                    context_pieces.append(f"[사례 {i+1} : 과거 라벨 {label} ({source})]\n> 내용: {doc}")
                retrieved_context = "\n\n".join(context_pieces)
        else:
            retrieved_context = "(로컬 Vector DB가 오프라인입니다.)"

        yield json.dumps({"progress": "AI가 정보를 받아 처리 중... 🤖"}) + "\n"

        rag_prompt = f"""
        당신은 개인용 보안 시스템의 코어 엔진 역할을 하는 RAG(검색 증강 생성) 기반 위협 분석 AI입니다.
        전문적인 기술 용어(RAG, 레이블, 데이터베이스 명칭 등)는 절대 쓰지 말고, 중학생도 이해할 수 있는 쉬운 일상어로 1~2문장으로 판정 이유를 대답해야 합니다.
        사용자가 웹에서 의심스러워 드래그한 텍스트에 스미싱, 피싱, 악성 메일 유도 등 사회공학적 사기 의도가 있는지 분석하세요.

        **[분석 대상 텍스트]**
        "{text}"

        **[RAG 지식베이스 검색 결과: 유사 과거 판례 3건]**
        {retrieved_context}
        
        위의 RAG 판례 기록과 텍스트 문맥을 대조하여 실질적 위협도를 종합 분석하세요.
        분석 결과는 **0~100점**의 score로 표기해야 합니다. (score가 높을수록 위험한 수치입니다.)
        
        반드시 지정된 아래 JSON Schema 형식으로만 응답하세요:
        {{"risk_level": "위험", "score": 95, "reason": "분석 결과, 이 문구는 기존에 신고된 과거 택배 사칭 수법과 내용이 매우 유사한 위험한 사기 문자 유형입니다.", "mitigation": "메시지에 포함된 링크를 절대로 클릭하지 마세요."}}
        """

        client = get_genai_client()
        if client is None:
            yield json.dumps({"risk_level": "에러", "score": 50, "reason": "Gemini API 키가 설정되지 않았습니다.", "mitigation": "-"}) + "\n"
            return

        response = await client.aio.models.generate_content(
            model='gemini-3.1-flash-lite',
            contents=rag_prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                safety_settings=[
                    types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold=types.HarmBlockThreshold.BLOCK_NONE),
                    types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_HARASSMENT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
                    types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
                    types.SafetySetting(category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold=types.HarmBlockThreshold.BLOCK_NONE),
                ]
            )
        )

        try:
            res_data = json.loads(response.text)
            if highest_sim_info:
                res_data["reason"] = res_data.get("reason", "") + highest_sim_info

            score = int(res_data.get("score", 50))
            
            raw_data_dict = {"rag_match": False, "ai_used": True}
            if retrieved_context:
                raw_data_dict["retrieved_context"] = retrieved_context
            raw_str = json.dumps(raw_data_dict, ensure_ascii=False)
            
            # Save into sqlite database
            # score in risk (higher is dangerous), convert to safety (100 - score) for safety logging
            log_analysis("web_text", text, str(100 - score), res_data.get("reason", ""), raw_str)
            
            yield json.dumps(res_data, ensure_ascii=False) + "\n"
        except json.JSONDecodeError:
            yield json.dumps({"risk_level": "에러", "score": 50, "reason": "AI 응답 파싱 중 오류가 발생했습니다.", "mitigation": "-"}) + "\n"
            
    except Exception as e:
        error_msg = str(e)
        if "503" in error_msg or "UNAVAILABLE" in error_msg:
            yield json.dumps({"risk_level": "분석 지연", "score": 50, "reason": "현재 API 서버 지연이 발생했습니다.", "mitigation": "나중에 다시 시도하세요."}) + "\n"
        else:
            yield json.dumps({"risk_level": "시스템 오류", "score": 50, "reason": f"에러 발생: {error_msg}", "mitigation": "-"}) + "\n"
