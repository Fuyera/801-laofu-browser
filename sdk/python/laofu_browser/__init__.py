"""Durable HTTP client. Writes are never automatically retried."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import time
from urllib.parse import urlsplit, quote
import uuid

class BrowserError(Exception):
    def __init__(self, code, message, status=None, retryable=False, details=None):
        super().__init__(message)
        self.code, self.status = code, status
        self.retryable, self.details = retryable, details

class BrowserClient:
    def __init__(self, base_url, token, timeout=35):
        self.base_url, self.token, self.timeout = base_url.rstrip('/'), token, timeout
        parts = urlsplit(base_url)
        if parts.scheme not in ('http', 'https') or parts.username or parts.password:
            raise ValueError('base_url requires http(s) without embedded credentials')
        self._parts = parts

    def _connection(self):
        cls = http.client.HTTPSConnection if self._parts.scheme == 'https' else http.client.HTTPConnection
        return cls(self._parts.hostname, self._parts.port, timeout=self.timeout)

    def _route(self, route):
        return self._parts.path.rstrip('/') + route

    @staticmethod
    def _data(response):
        data = json.loads(response.read())
        if response.status >= 400:
            error = data.get('error', {})
            raise BrowserError(error.get('code', 'HTTP_ERROR'), error.get('message', 'Request failed'), response.status, error.get('retryable', False), error.get('details'))
        return data

    def request(self, method, route, body=None, headers=None):
        conn = self._connection()
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
        hdr = {'Authorization': 'Bearer ' + self.token, **(headers or {})}
        if data is not None: hdr['Content-Type'] = 'application/json'
        try:
            conn.request(method, self._route(route), data, hdr)
            return self._data(conn.getresponse())
        finally:
            conn.close()

    def capabilities(self): return self.request('GET', '/v1/capabilities')
    def session(self, profile_id): return self.request('POST', '/v1/sessions', {'profileId': profile_id})
    def submit_task(self, body, idempotency_key):
        return self.request('POST', '/v1/tasks', body, {'Idempotency-Key': idempotency_key})
    def command(self, session_id, body, idempotency_key):
        return self.request('POST', f'/v1/sessions/{quote(session_id, safe="")}/commands', body, {'Idempotency-Key': idempotency_key})
    def job(self, job_id):
        return self.request('GET', '/v1/' + ('tasks' if job_id.startswith('tsk_') else 'commands') + '/' + quote(job_id, safe=''))
    def cancel(self, job_id):
        return self.request('POST', '/v1/' + ('tasks' if job_id.startswith('tsk_') else 'commands') + '/' + quote(job_id, safe='') + '/cancel', {})
    def resume(self, job_id): return self.request('POST', '/v1/tasks/' + quote(job_id, safe='') + '/resume', {})
    def wait(self, job_id, timeout=900, interval=0.5):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            job = self.job(job_id)
            if job['state'] in ('succeeded','partial','failed','cancelled','waiting_user','suspended'): return job
            time.sleep(interval)
        raise BrowserError('CLIENT_WAIT_TIMEOUT', 'Task remains available by its original ID')

    def upload(self, source):
        source = Path(source)
        digest = hashlib.sha256()
        with source.open('rb') as file:
            for block in iter(lambda: file.read(1024*1024), b''): digest.update(block)
        conn = self._connection()
        try:
            conn.putrequest('POST', self._route('/v1/artifacts'))
            for key, value in {'Authorization':'Bearer '+self.token, 'Content-Type':'application/octet-stream', 'Content-Length':str(source.stat().st_size), 'X-Filename':quote(source.name), 'X-Sha256':digest.hexdigest()}.items(): conn.putheader(key, value)
            conn.endheaders()
            with source.open('rb') as file:
                for block in iter(lambda: file.read(1024*1024), b''): conn.send(block)
            return self._data(conn.getresponse())
        finally:
            conn.close()

    def download(self, artifact_id, destination):
        artifact_id = quote(artifact_id, safe='')
        meta = self.request('GET', '/v1/artifacts/'+artifact_id)
        target = Path(destination); target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(target.name+'.'+uuid.uuid4().hex+'.partial')
        conn = self._connection(); digest = hashlib.sha256(); size = 0
        try:
            conn.request('GET', self._route('/v1/artifacts/'+artifact_id+'/content'), headers={'Authorization':'Bearer '+self.token})
            response = conn.getresponse()
            if response.status >= 400: self._data(response)
            with temporary.open('xb') as file:
                os.chmod(temporary, 0o600)
                for block in iter(lambda: response.read(1024*1024), b''):
                    size += len(block)
                    if size > meta['bytes']: raise BrowserError('ARTIFACT_INCOMPLETE','Download exceeds declared length')
                    digest.update(block); file.write(block)
                file.flush(); os.fsync(file.fileno())
            if size != meta['bytes'] or digest.hexdigest() != meta['sha256']:
                raise BrowserError('ARTIFACT_INCOMPLETE','Download integrity check failed')
            temporary.replace(target)
            return meta
        finally:
            conn.close()
            temporary.unlink(missing_ok=True)
