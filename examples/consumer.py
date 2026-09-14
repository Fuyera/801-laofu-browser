import json, os
from pathlib import Path
import time
from urllib.request import urlopen
from laofu_browser import BrowserClient
c = BrowserClient(os.environ['LAOFU_URL'], os.environ['LAOFU_TOKEN'])
profile_id, source = os.environ['LAOFU_PROFILE'], os.environ['LAOFU_SAMPLE_URL']
Path('upload.bin').write_bytes(bytes([43])*(12*1024*1024))
upload = c.upload('upload.bin'); c.download(upload['id'], 'uploaded-copy.bin')
task = c.submit_task({'type':'article.capture@v1','execution':{'profileId':profile_id},'input':{'url':source+'/article'}}, 'py-capture')
done = c.wait(task['id']); assert done['state'] == 'succeeded', done
c.download(next(a['id'] for a in done['artifacts'] if a['filename'].endswith('.zip')), 'article.zip')
gate = c.submit_task({'type':'article.capture@v1','execution':{'profileId':profile_id},'input':{'url':source+'/gate?client=py'}}, 'py-gate')
assert c.wait(gate['id'])['state'] == 'waiting_user'
with urlopen(source+'/unlock?client=py') as response: response.read()
time.sleep(0.8); c.resume(gate['id']); resumed = c.wait(gate['id']); assert resumed['state'] == 'succeeded', resumed
cancelled = c.submit_task({'type':'article.capture@v1','execution':{'profileId':os.environ['LAOFU_OFFLINE_PROFILE']},'input':{'url':source+'/article'}}, 'py-cancel')
assert c.cancel(cancelled['id'])['state'] == 'cancelled'
Path('result.json').write_text(json.dumps({'sdk':'python','capture':done['id'],'resumed':resumed['id'],'cancelled':cancelled['id'],'upload':upload['id'],'state':done['state']}))
print('Python installed package: capture/upload/download/query/cancel/resume passed')
