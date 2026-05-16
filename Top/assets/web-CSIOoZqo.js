import { ai as a126_0x2d04e2, cx as a126_0xd80e6c } from './index-CGHnJCzV.js';
import { kc as a126_0x2ec35c } from './app-hLqRDvZo.js';
function m(_0x12f7e8) {
    const _0x21b1a4 = _0x12f7e8['split']('/')['filter'](_0x1235e2 => _0x1235e2 !== '.')
        , _0xe04fa4 = [];
    return _0x21b1a4['forEach'](_0x369a54 => {
        _0x369a54 === '..' && _0xe04fa4['length'] > 0x0 && _0xe04fa4[_0xe04fa4['length'] - 0x1] !== '..' ? _0xe04fa4['pop']() : _0xe04fa4['push'](_0x369a54);
    }
    ),
        _0xe04fa4['join']('/');
}
function R(_0x2c5be9, _0x2f6073) {
    _0x2c5be9 = m(_0x2c5be9),
        _0x2f6073 = m(_0x2f6073);
    const _0x5430ab = _0x2c5be9['split']('/')
        , _0x24cf34 = _0x2f6073['split']('/');
    return _0x2c5be9 !== _0x2f6073 && _0x5430ab['every']((_0x1a5930, _0x2f60ff) => _0x1a5930 === _0x24cf34[_0x2f60ff]);
}
class g extends a126_0x2d04e2 {
    constructor() {
        super(...arguments),
            this['DB_VERSION'] = 0x1,
            this['DB_NAME'] = 'Disc',
            this['_writeCmds'] = ['add', 'put', 'delete'],
            this['downloadFile'] = async _0x1371cf => {
                var _0x15932b, _0x48ccc5;
                const _0x56e312 = a126_0xd80e6c(_0x1371cf, _0x1371cf['webFetchExtra'])
                    , _0x21cc13 = await fetch(_0x1371cf['url'], _0x56e312);
                let _0x4a9e38;
                if (!_0x1371cf['progress'])
                    _0x4a9e38 = await _0x21cc13['blob']();
                else {
                    if (!(_0x21cc13 != null && _0x21cc13['body']))
                        _0x4a9e38 = new Blob();
                    else {
                        const _0x306013 = _0x21cc13['body']['getReader']();
                        let _0x5d5220 = 0x0;
                        const _0x5e7f73 = []
                            , _0x45293c = _0x21cc13['headers']['get']('content-type')
                            , _0x5bc270 = parseInt(_0x21cc13['headers']['get']('content-length') || '0', 0xa);
                        for (; ;) {
                            const { done: _0x2757c0, value: _0x641158 } = await _0x306013['read']();
                            if (_0x2757c0)
                                break;
                            _0x5e7f73['push'](_0x641158),
                                _0x5d5220 += (_0x641158 == null ? void 0x0 : _0x641158['length']) || 0x0;
                            const _0x3e4314 = {
                                'url': _0x1371cf['url'],
                                'bytes': _0x5d5220,
                                'contentLength': _0x5bc270
                            };
                            this['notifyListeners']('progress', _0x3e4314);
                        }
                        const _0x59e035 = new Uint8Array(_0x5d5220);
                        let _0x4be452 = 0x0;
                        for (const _0x36ee65 of _0x5e7f73)
                            typeof _0x36ee65 > 'u' || (_0x59e035['set'](_0x36ee65, _0x4be452),
                                _0x4be452 += _0x36ee65['length']);
                        _0x4a9e38 = new Blob([_0x59e035['buffer']], {
                            'type': _0x45293c || void 0x0
                        });
                    }
                }
                return {
                    'path': (await this['writeFile']({
                        'path': _0x1371cf['path'],
                        'directory': (_0x15932b = _0x1371cf['directory']) !== null && _0x15932b !== void 0x0 ? _0x15932b : void 0x0,
                        'recursive': (_0x48ccc5 = _0x1371cf['recursive']) !== null && _0x48ccc5 !== void 0x0 ? _0x48ccc5 : !0x1,
                        'data': _0x4a9e38
                    }))['uri'],
                    'blob': _0x4a9e38
                };
            }
            ;
    }
    ['readFileInChunks'](_0x3669e4, _0x14ebed) {
        throw this['unavailable']('Method\x20not\x20implemented.');
    }
    async['initDb']() {
        if (this['_db'] !== void 0x0)
            return this['_db'];
        if (!('indexedDB' in window))
            throw this['unavailable']('This\x20browser\x20doesn\x27t\x20support\x20IndexedDB');
        return new Promise((_0x19c67b, _0x561703) => {
            const _0x2df6de = indexedDB['open'](this['DB_NAME'], this['DB_VERSION']);
            _0x2df6de['onupgradeneeded'] = g['doUpgrade'],
                _0x2df6de['onsuccess'] = () => {
                    this['_db'] = _0x2df6de['result'],
                        _0x19c67b(_0x2df6de['result']);
                }
                ,
                _0x2df6de['onerror'] = () => _0x561703(_0x2df6de['error']),
                _0x2df6de['onblocked'] = () => {
                    console['warn']('db\x20blocked');
                }
                ;
        }
        );
    }
    static ['doUpgrade'](_0x425e8a) {
        const _0x549ab8 = _0x425e8a['target']['result'];
        switch (_0x425e8a['oldVersion']) {
            case 0x0:
            case 0x1:
            default:
                _0x549ab8['objectStoreNames']['contains']('FileStorage') && _0x549ab8['deleteObjectStore']('FileStorage'),
                    _0x549ab8['createObjectStore']('FileStorage', {
                        'keyPath': 'path'
                    })['createIndex']('by_folder', 'folder');
        }
    }
    async['dbRequest'](_0x52206a, _0x1d74dc) {
        const _0x5b934d = this['_writeCmds']['indexOf'](_0x52206a) !== -0x1 ? 'readwrite' : 'readonly';
        return this['initDb']()['then'](_0x5ecc0a => new Promise((_0x50ec5e, _0x3062a9) => {
            const _0x1c16ab = _0x5ecc0a['transaction'](['FileStorage'], _0x5b934d)['objectStore']('FileStorage')[_0x52206a](..._0x1d74dc);
            _0x1c16ab['onsuccess'] = () => _0x50ec5e(_0x1c16ab['result']),
                _0x1c16ab['onerror'] = () => _0x3062a9(_0x1c16ab['error']);
        }
        ));
    }
    async['dbIndexRequest'](_0x1d9915, _0x5ef012, _0x1f4732) {
        const _0x22f6af = this['_writeCmds']['indexOf'](_0x5ef012) !== -0x1 ? 'readwrite' : 'readonly';
        return this['initDb']()['then'](_0x2e5adb => new Promise((_0x2cfa0d, _0x48f9ae) => {
            const _0x4a96c0 = _0x2e5adb['transaction'](['FileStorage'], _0x22f6af)['objectStore']('FileStorage')['index'](_0x1d9915)[_0x5ef012](..._0x1f4732);
            _0x4a96c0['onsuccess'] = () => _0x2cfa0d(_0x4a96c0['result']),
                _0x4a96c0['onerror'] = () => _0x48f9ae(_0x4a96c0['error']);
        }
        ));
    }
    ['getPath'](_0x57be74, _0x4bacde) {
        const _0x5b4095 = _0x4bacde !== void 0x0 ? _0x4bacde['replace'](/^[/]+|[/]+$/g, '') : '';
        let _0x212447 = '';
        return _0x57be74 !== void 0x0 && (_0x212447 += '/' + _0x57be74),
            _0x4bacde !== '' && (_0x212447 += '/' + _0x5b4095),
            _0x212447;
    }
    async['clear']() {
        (await this['initDb']())['transaction'](['FileStorage'], 'readwrite')['objectStore']('FileStorage')['clear']();
    }
    async['readFile'](_0x9625b3) {
        const _0x555591 = this['getPath'](_0x9625b3['directory'], _0x9625b3['path'])
            , _0x22241b = await this['dbRequest']('get', [_0x555591]);
        if (_0x22241b === void 0x0)
            throw Error('File\x20does\x20not\x20exist.');
        return {
            'data': _0x22241b['content'] ? _0x22241b['content'] : ''
        };
    }
    async['writeFile'](_0x3e68b9) {
        const _0x1d1f95 = this['getPath'](_0x3e68b9['directory'], _0x3e68b9['path']);
        let _0xb383af = _0x3e68b9['data'];
        const _0x321099 = _0x3e68b9['encoding']
            , _0x3c8d0d = _0x3e68b9['recursive']
            , _0x4878f6 = await this['dbRequest']('get', [_0x1d1f95]);
        if (_0x4878f6 && _0x4878f6['type'] === 'directory')
            throw Error('The\x20supplied\x20path\x20is\x20a\x20directory.');
        const _0x28da8a = _0x1d1f95['substr'](0x0, _0x1d1f95['lastIndexOf']('/'));
        if (await this['dbRequest']('get', [_0x28da8a]) === void 0x0) {
            const _0x32dda3 = _0x28da8a['indexOf']('/', 0x1);
            if (_0x32dda3 !== -0x1) {
                const _0x5463e2 = _0x28da8a['substr'](_0x32dda3);
                await this['mkdir']({
                    'path': _0x5463e2,
                    'directory': _0x3e68b9['directory'],
                    'recursive': _0x3c8d0d
                });
            }
        }
        if (!_0x321099 && !(_0xb383af instanceof Blob) && (_0xb383af = _0xb383af['indexOf'](',') >= 0x0 ? _0xb383af['split'](',')[0x1] : _0xb383af,
            !this['isBase64String'](_0xb383af)))
            throw Error('The\x20supplied\x20data\x20is\x20not\x20valid\x20base64\x20content.');
        const _0x351bb4 = Date['now']()
            , _0xfc9b27 = {
                'path': _0x1d1f95,
                'folder': _0x28da8a,
                'type': 'file',
                'size': _0xb383af instanceof Blob ? _0xb383af['size'] : _0xb383af['length'],
                'ctime': _0x351bb4,
                'mtime': _0x351bb4,
                'content': _0xb383af
            };
        return await this['dbRequest']('put', [_0xfc9b27]),
        {
            'uri': _0xfc9b27['path']
        };
    }
    async['appendFile'](_0x53fdc9) {
        const _0x3cf9e3 = this['getPath'](_0x53fdc9['directory'], _0x53fdc9['path']);
        let _0x1ab2dd = _0x53fdc9['data'];
        const _0x14c993 = _0x53fdc9['encoding']
            , _0x3b752d = _0x3cf9e3['substr'](0x0, _0x3cf9e3['lastIndexOf']('/'))
            , _0x7a2d97 = Date['now']();
        let _0x23b6fc = _0x7a2d97;
        const _0x5b8312 = await this['dbRequest']('get', [_0x3cf9e3]);
        if (_0x5b8312 && _0x5b8312['type'] === 'directory')
            throw Error('The\x20supplied\x20path\x20is\x20a\x20directory.');
        if (await this['dbRequest']('get', [_0x3b752d]) === void 0x0) {
            const _0x1db8d6 = _0x3b752d['indexOf']('/', 0x1);
            if (_0x1db8d6 !== -0x1) {
                const _0x2d760f = _0x3b752d['substr'](_0x1db8d6);
                await this['mkdir']({
                    'path': _0x2d760f,
                    'directory': _0x53fdc9['directory'],
                    'recursive': !0x0
                });
            }
        }
        if (!_0x14c993 && !this['isBase64String'](_0x1ab2dd))
            throw Error('The\x20supplied\x20data\x20is\x20not\x20valid\x20base64\x20content.');
        if (_0x5b8312 !== void 0x0) {
            if (_0x5b8312['content'] instanceof Blob)
                throw Error('The\x20occupied\x20entry\x20contains\x20a\x20Blob\x20object\x20which\x20cannot\x20be\x20appended\x20to.');
            _0x5b8312['content'] !== void 0x0 && !_0x14c993 ? _0x1ab2dd = btoa(atob(_0x5b8312['content']) + atob(_0x1ab2dd)) : _0x1ab2dd = _0x5b8312['content'] + _0x1ab2dd,
                _0x23b6fc = _0x5b8312['ctime'];
        }
        const _0x4094c5 = {
            'path': _0x3cf9e3,
            'folder': _0x3b752d,
            'type': 'file',
            'size': _0x1ab2dd['length'],
            'ctime': _0x23b6fc,
            'mtime': _0x7a2d97,
            'content': _0x1ab2dd
        };
        await this['dbRequest']('put', [_0x4094c5]);
    }
    async['deleteFile'](_0x47605e) {
        const _0x11bed7 = this['getPath'](_0x47605e['directory'], _0x47605e['path']);
        if (await this['dbRequest']('get', [_0x11bed7]) === void 0x0)
            throw Error('File\x20does\x20not\x20exist.');
        if ((await this['dbIndexRequest']('by_folder', 'getAllKeys', [IDBKeyRange['only'](_0x11bed7)]))['length'] !== 0x0)
            throw Error('Folder\x20is\x20not\x20empty.');
        await this['dbRequest']('delete', [_0x11bed7]);
    }
    async['mkdir'](_0x352d13) {
        const _0x4041d3 = this['getPath'](_0x352d13['directory'], _0x352d13['path'])
            , _0x50a75e = _0x352d13['recursive']
            , _0x28e5eb = _0x4041d3['substr'](0x0, _0x4041d3['lastIndexOf']('/'))
            , _0x7cd049 = (_0x4041d3['match'](/\//g) || [])['length']
            , _0x37ced5 = await this['dbRequest']('get', [_0x28e5eb])
            , _0x1dd7bd = await this['dbRequest']('get', [_0x4041d3]);
        if (_0x7cd049 === 0x1)
            throw Error('Cannot\x20create\x20Root\x20directory');
        if (_0x1dd7bd !== void 0x0)
            throw Error('Current\x20directory\x20does\x20already\x20exist.');
        if (!_0x50a75e && _0x7cd049 !== 0x2 && _0x37ced5 === void 0x0)
            throw Error('Parent\x20directory\x20must\x20exist');
        if (_0x50a75e && _0x7cd049 !== 0x2 && _0x37ced5 === void 0x0) {
            const _0x3d2281 = _0x28e5eb['substr'](_0x28e5eb['indexOf']('/', 0x1));
            await this['mkdir']({
                'path': _0x3d2281,
                'directory': _0x352d13['directory'],
                'recursive': _0x50a75e
            });
        }
        const _0xc910d6 = Date['now']()
            , _0x19e6f7 = {
                'path': _0x4041d3,
                'folder': _0x28e5eb,
                'type': 'directory',
                'size': 0x0,
                'ctime': _0xc910d6,
                'mtime': _0xc910d6
            };
        await this['dbRequest']('put', [_0x19e6f7]);
    }
    async['rmdir'](_0x2ae6a6) {
        const { path: _0x5486af, directory: _0x2c0585, recursive: _0x34577b } = _0x2ae6a6
            , _0x337242 = this['getPath'](_0x2c0585, _0x5486af)
            , _0x34e82f = await this['dbRequest']('get', [_0x337242]);
        if (_0x34e82f === void 0x0)
            throw Error('Folder\x20does\x20not\x20exist.');
        if (_0x34e82f['type'] !== 'directory')
            throw Error('Requested\x20path\x20is\x20not\x20a\x20directory');
        const _0x42f865 = await this['readdir']({
            'path': _0x5486af,
            'directory': _0x2c0585
        });
        if (_0x42f865['files']['length'] !== 0x0 && !_0x34577b)
            throw Error('Folder\x20is\x20not\x20empty');
        for (const _0x2170ff of _0x42f865['files']) {
            const _0x429782 = _0x5486af + '/' + _0x2170ff['name'];
            (await this['stat']({
                'path': _0x429782,
                'directory': _0x2c0585
            }))['type'] === 'file' ? await this['deleteFile']({
                'path': _0x429782,
                'directory': _0x2c0585
            }) : await this['rmdir']({
                'path': _0x429782,
                'directory': _0x2c0585,
                'recursive': _0x34577b
            });
        }
        await this['dbRequest']('delete', [_0x337242]);
    }
    async['readdir'](_0xb95312) {
        const _0x25d730 = this['getPath'](_0xb95312['directory'], _0xb95312['path'])
            , _0x2c3a06 = await this['dbRequest']('get', [_0x25d730]);
        if (_0xb95312['path'] !== '' && _0x2c3a06 === void 0x0)
            throw Error('Folder\x20does\x20not\x20exist.');
        const _0x58d8ad = await this['dbIndexRequest']('by_folder', 'getAllKeys', [IDBKeyRange['only'](_0x25d730)]);
        return {
            'files': await Promise['all'](_0x58d8ad['map'](async _0x14ca85 => {
                let _0x4be8e7 = await this['dbRequest']('get', [_0x14ca85]);
                return _0x4be8e7 === void 0x0 && (_0x4be8e7 = await this['dbRequest']('get', [_0x14ca85 + '/'])),
                {
                    'name': _0x14ca85['substring'](_0x25d730['length'] + 0x1),
                    'type': _0x4be8e7['type'],
                    'size': _0x4be8e7['size'],
                    'ctime': _0x4be8e7['ctime'],
                    'mtime': _0x4be8e7['mtime'],
                    'uri': _0x4be8e7['path']
                };
            }
            ))
        };
    }
    async['getUri'](_0x421864) {
        const _0x54a38e = this['getPath'](_0x421864['directory'], _0x421864['path']);
        let _0x59989c = await this['dbRequest']('get', [_0x54a38e]);
        return _0x59989c === void 0x0 && (_0x59989c = await this['dbRequest']('get', [_0x54a38e + '/'])),
        {
            'uri': (_0x59989c == null ? void 0x0 : _0x59989c['path']) || _0x54a38e
        };
    }
    async['stat'](_0x4f08af) {
        const _0x7db697 = this['getPath'](_0x4f08af['directory'], _0x4f08af['path']);
        let _0x2b1726 = await this['dbRequest']('get', [_0x7db697]);
        if (_0x2b1726 === void 0x0 && (_0x2b1726 = await this['dbRequest']('get', [_0x7db697 + '/'])),
            _0x2b1726 === void 0x0)
            throw Error('Entry\x20does\x20not\x20exist.');
        return {
            'name': _0x2b1726['path']['substring'](_0x7db697['length'] + 0x1),
            'type': _0x2b1726['type'],
            'size': _0x2b1726['size'],
            'ctime': _0x2b1726['ctime'],
            'mtime': _0x2b1726['mtime'],
            'uri': _0x2b1726['path']
        };
    }
    async['rename'](_0x51fa72) {
        await this['_copy'](_0x51fa72, !0x0);
    }
    async['copy'](_0x1ccd53) {
        return this['_copy'](_0x1ccd53, !0x1);
    }
    async['requestPermissions']() {
        return {
            'publicStorage': 'granted'
        };
    }
    async['checkPermissions']() {
        return {
            'publicStorage': 'granted'
        };
    }
    async['_copy'](_0x28e6f4, _0x3cb00e = !0x1) {
        let { toDirectory: _0x3f6fb0 } = _0x28e6f4;
        const { to: _0x268a0a, from: _0x342066, directory: _0x1209aa } = _0x28e6f4;
        if (!_0x268a0a || !_0x342066)
            throw Error('Both\x20to\x20and\x20from\x20must\x20be\x20provided');
        _0x3f6fb0 || (_0x3f6fb0 = _0x1209aa);
        const _0x59acea = this['getPath'](_0x1209aa, _0x342066)
            , _0x359130 = this['getPath'](_0x3f6fb0, _0x268a0a);
        if (_0x59acea === _0x359130)
            return {
                'uri': _0x359130
            };
        if (R(_0x59acea, _0x359130))
            throw Error('To\x20path\x20cannot\x20contain\x20the\x20from\x20path');
        let _0x22772e;
        try {
            _0x22772e = await this['stat']({
                'path': _0x268a0a,
                'directory': _0x3f6fb0
            });
        } catch {
            const _0x466e5e = _0x268a0a['split']('/');
            _0x466e5e['pop']();
            const _0x42c51d = _0x466e5e['join']('/');
            if (_0x466e5e['length'] > 0x0 && (await this['stat']({
                'path': _0x42c51d,
                'directory': _0x3f6fb0
            }))['type'] !== 'directory')
                throw new Error('Parent\x20directory\x20of\x20the\x20to\x20path\x20is\x20a\x20file');
        }
        if (_0x22772e && _0x22772e['type'] === 'directory')
            throw new Error('Cannot\x20overwrite\x20a\x20directory\x20with\x20a\x20file');
        const _0x2cc69a = await this['stat']({
            'path': _0x342066,
            'directory': _0x1209aa
        })
            , _0x5b8480 = async (_0x5327ca, _0x4bfeb7, _0x21a7aa) => {
                const _0xca8244 = this['getPath'](_0x3f6fb0, _0x5327ca)
                    , _0x473f8e = await this['dbRequest']('get', [_0xca8244]);
                _0x473f8e['ctime'] = _0x4bfeb7,
                    _0x473f8e['mtime'] = _0x21a7aa,
                    await this['dbRequest']('put', [_0x473f8e]);
            }
            , _0x4fc5c1 = _0x2cc69a['ctime'] ? _0x2cc69a['ctime'] : Date['now']();
        switch (_0x2cc69a['type']) {
            case 'file':
                {
                    const _0x15e385 = await this['readFile']({
                        'path': _0x342066,
                        'directory': _0x1209aa
                    });
                    _0x3cb00e && await this['deleteFile']({
                        'path': _0x342066,
                        'directory': _0x1209aa
                    });
                    let _0x5b5c71;
                    !(_0x15e385['data'] instanceof Blob) && !this['isBase64String'](_0x15e385['data']) && (_0x5b5c71 = a126_0x2ec35c['UTF8']);
                    const _0x196d90 = await this['writeFile']({
                        'path': _0x268a0a,
                        'directory': _0x3f6fb0,
                        'data': _0x15e385['data'],
                        'encoding': _0x5b5c71
                    });
                    return _0x3cb00e && await _0x5b8480(_0x268a0a, _0x4fc5c1, _0x2cc69a['mtime']),
                        _0x196d90;
                }
            case 'directory':
                {
                    if (_0x22772e)
                        throw Error('Cannot\x20move\x20a\x20directory\x20over\x20an\x20existing\x20object');
                    try {
                        await this['mkdir']({
                            'path': _0x268a0a,
                            'directory': _0x3f6fb0,
                            'recursive': !0x1
                        }),
                            _0x3cb00e && await _0x5b8480(_0x268a0a, _0x4fc5c1, _0x2cc69a['mtime']);
                    } catch { }
                    const _0x4f5d50 = (await this['readdir']({
                        'path': _0x342066,
                        'directory': _0x1209aa
                    }))['files'];
                    for (const _0x3d023a of _0x4f5d50)
                        await this['_copy']({
                            'from': _0x342066 + '/' + _0x3d023a['name'],
                            'to': _0x268a0a + '/' + _0x3d023a['name'],
                            'directory': _0x1209aa,
                            'toDirectory': _0x3f6fb0
                        }, _0x3cb00e);
                    _0x3cb00e && await this['rmdir']({
                        'path': _0x342066,
                        'directory': _0x1209aa
                    });
                }
        }
        return {
            'uri': _0x359130
        };
    }
    ['isBase64String'](_0x49be66) {
        try {
            return btoa(atob(_0x49be66)) == _0x49be66;
        } catch {
            return !0x1;
        }
    }
}
g['_debug'] = !0x0;
export { g as FilesystemWeb };

