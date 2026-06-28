# storage.py - 추상 스토리지 인터페이스 및 MockStorage 구현체

from abc import ABC, abstractmethod

class StorageInterface(ABC):
    """업로드 및 스토리지 처리를 담당하는 공통 인터페이스"""

    @abstractmethod
    async def upload_canvas(self, room_id: str, image_bytes: bytes) -> str:
        """캔버스 이미지 바이트를 지정된 룸 ID 경로에 업로드하고 접근 가능한 URL을 반환합니다.

        Args:
            room_id: 대상 방의 고유 ID
            image_bytes: 업로드할 이미지 파일 바이트 데이터

        Returns:
            str: 업로드된 파일의 웹 접근 URL
        """
        pass


class MockStorage(StorageInterface):
    """로컬 테스트 및 개발용 Mock 스토리지 구현체"""

    async def upload_canvas(self, room_id: str, image_bytes: bytes) -> str:
        """실제 업로드 없이 가상의 로컬 파일 URL을 생성하여 즉시 반환합니다.

        Args:
            room_id: 대상 방의 고유 ID
            image_bytes: 업로드할 이미지 파일 바이트 데이터 (Mock에서는 사용 안 함)

        Returns:
            str: 가상의 파일 URL (http://mockstorage.local/{room_id}/canvas.png)
        """
        # 실제 환경에서는 S3, NCP Object Storage 등으로 저장하고 URL을 반환합니다.
        mock_url = f"http://mockstorage.local/{room_id}/canvas.png"
        return mock_url
