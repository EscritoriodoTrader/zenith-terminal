import { ai as a133_0x180abf } from './index-CGHnJCzV.js';
function o() {
    const _0x4c020a = window['navigator']['connection'] || window['navigator']['mozConnection'] || window['navigator']['webkitConnection'];
    let _0x4aa58e = 'unknown';
    const _0x42f331 = _0x4c020a ? _0x4c020a['type'] || _0x4c020a['effectiveType'] : null;
    if (_0x42f331 && typeof _0x42f331 == 'string')
        switch (_0x42f331) {
            case 'bluetooth':
            case 'cellular':
                _0x4aa58e = 'cellular';
                break;
            case 'none':
                _0x4aa58e = 'none';
                break;
            case 'ethernet':
            case 'wifi':
            case 'wimax':
                _0x4aa58e = 'wifi';
                break;
            case 'other':
            case 'unknown':
                _0x4aa58e = 'unknown';
                break;
            case 'slow-2g':
            case '2g':
            case '3g':
                _0x4aa58e = 'cellular';
                break;
            case '4g':
                _0x4aa58e = 'wifi';
                break;
        }
    return _0x4aa58e;
}
class s extends a133_0x180abf {
    constructor() {
        super(),
            this['handleOnline'] = () => {
                const _0xbb58ac = {
                    'connected': !0x0,
                    'connectionType': o()
                };
                this['notifyListeners']('networkStatusChange', _0xbb58ac);
            }
            ,
            this['handleOffline'] = () => {
                const _0x5bcec6 = {
                    'connected': !0x1,
                    'connectionType': 'none'
                };
                this['notifyListeners']('networkStatusChange', _0x5bcec6);
            }
            ,
            typeof window < 'u' && (window['addEventListener']('online', this['handleOnline']),
                window['addEventListener']('offline', this['handleOffline']));
    }
    async['getStatus']() {
        if (!window['navigator'])
            throw this['unavailable']('Browser\x20does\x20not\x20support\x20the\x20Network\x20Information\x20API');
        const _0x5a3dbb = window['navigator']['onLine']
            , _0x5932b1 = o();
        return {
            'connected': _0x5a3dbb,
            'connectionType': _0x5a3dbb ? _0x5932b1 : 'none'
        };
    }
}
const r = new s();
export { r as Network, s as NetworkWeb };
