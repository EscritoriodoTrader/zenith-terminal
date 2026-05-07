import time
import comtypes.client
from comtypes import COMObject
import traceback

print("1. Gerando biblioteca do Excel via comtypes...")
try:
    ExcelLib = comtypes.client.GetModule(('{00020813-0000-0000-C000-000000000046}', 1, 9))
except Exception:
    try:
        ExcelLib = comtypes.client.GetModule(('{00020813-0000-0000-C000-000000000046}', 1, 8))
    except Exception:
        print("Falha ao carregar a biblioteca do Excel.")
        exit(1)

class RTDCallback(COMObject):
    _com_interfaces_ = [ExcelLib.IRTDUpdateEvent]
    
    def __init__(self):
        super(RTDCallback, self).__init__()
        self._HeartbeatInterval = -1
        self.tem_dados_novos = False
        
    def UpdateNotify(self):
        self.tem_dados_novos = True
        
    def _get_HeartbeatInterval(self):
        return self._HeartbeatInterval
        
    def _set_HeartbeatInterval(self, value):
        self._HeartbeatInterval = value
        
    def Disconnect(self):
        pass

def test():
    print("2. Criando o cliente RTD via comtypes...")
    try:
        rtd = comtypes.client.CreateObject("rtdtrading.rtdserver", interface=ExcelLib.IRtdServer)
    except Exception as e:
        print("Erro ao criar objeto RTD:", e)
        return
        
    cb = RTDCallback()
    print("3. Iniciando Server (ServerStart)...")
    try:
        rtd.ServerStart(cb)
    except Exception as e:
        print("Erro no ServerStart:", e)
        traceback.print_exc()
        return
        
    print("4. Conectando topico (ULT)...")
    try:
        # Tenta passar como tupla normal, o comtypes as vezes converte para SAFEARRAY
        args = ("ESM6_M_0", "ULT")
        rtd.ConnectData(1, args, True)
    except Exception as e:
        print("Erro no ConnectData:", e)
        traceback.print_exc()
        return
        
    print("Aguardando dados por 5 segundos...")
    import ctypes
    for _ in range(50):
        ctypes.windll.user32.MsgWaitForMultipleObjects(0, 0, 0, 100, 255)
        if cb.tem_dados_novos:
            cb.tem_dados_novos = False
            data = rtd.RefreshData(0)
            print("DADOS RECEBIDOS:", data)
    
    rtd.ServerTerminate()

if __name__ == "__main__":
    test()
