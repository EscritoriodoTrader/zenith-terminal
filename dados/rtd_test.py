import win32com.client
import pythoncom
import time
import win32com.server.util
import win32com.client.gencache

class RTDCallback:
    # Interface padrão do Excel para receber aviso de novos dados RTD
    _public_methods_ = ['UpdateNotify']
    _public_attrs_ = ['HeartbeatInterval', 'Disconnect']
    # A IID exata do IRTDUpdateEvent para nao depender do Excel
    _com_interfaces_ = ['{A43788C1-D91B-11D3-8F39-00C04F3651B8}']
    
    def __init__(self):
        self.HeartbeatInterval = -1
        self.Disconnect = False
        self.tem_dados_novos = False
        
    def UpdateNotify(self):
        self.tem_dados_novos = True

def test_rtd():
    print("--- INICIANDO TESTE RTD DIRETO ---")
    pythoncom.CoInitialize()
    
    try:
        print("1. Conectando ao rtdtrading.rtdserver...")
        rtd = win32com.client.Dispatch("rtdtrading.rtdserver")
    except Exception as e:
        print("ERRO: O servidor RTD da corretora não foi encontrado ou está fechado.")
        print("Detalhes:", e)
        return
        
    try:
        print("2. Carregando Type Library do Excel para entender o RTD...")
        # Isso forca o python a carregar as definicoes de IRTDUpdateEvent
        excel = win32com.client.gencache.EnsureDispatch("Excel.Application")
        excel.Quit()
        
        print("3. Criando o falso Excel (Callback)...")
        callback = RTDCallback()
        callback_com = win32com.server.util.wrap(callback)
        
        print("4. Iniciando servidor...")
        rtd.ServerStart(callback_com)
        
        print("4. Assinando o último preço (ESM6_M_0, ULT)...")
        # ID 1 = Tópico 1. O True significa que queremos dados novos
        rtd.ConnectData(1, ("ESM6_M_0", "ULT"), True)
        
        print("5. Assinando o primeiro trade do Times Compra (T&T0, PRE, 0)...")
        rtd.ConnectData(2, ("T&T0", "PRE", "0"), True)
        
        print("\nPronto! Escutando o mercado ao vivo por 10 segundos...\n")
        
        for i in range(100):
            pythoncom.PumpWaitingMessages() # Processa a fila do Windows
            if callback.tem_dados_novos:
                callback.tem_dados_novos = False
                # Pega os dados que chegaram
                novos_dados = rtd.RefreshData(0)
                print(f"[RTD ATUALIZOU]: {novos_dados}")
            time.sleep(0.1)
            
        print("\nDesconectando do RTD...")
        rtd.DisconnectData(1)
        rtd.DisconnectData(2)
        rtd.ServerTerminate()
        print("Teste finalizado com sucesso!")
        
    except Exception as e:
        print("\nOcorreu um erro durante a execução:")
        print(e)
        print("Isso geralmente significa que a biblioteca COM do Windows precisa ser registrada de outra forma.")

if __name__ == "__main__":
    test_rtd()
