import webview
from app_core.api import Api

if __name__ == '__main__':
    api = Api()
    window = webview.create_window(
        title='Angular + Python (Dev)',
        url='http://localhost:4200',
        js_api=api,
    )
    webview.start(debug=True, http_server=False, gui='edgechromium')
