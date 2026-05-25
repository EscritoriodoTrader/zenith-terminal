/**
 * system-controls.js — Zenith System Controls
 * Gerencia os botões de controle de sistema no topo direito:
 * 1. Abrir Terminal (Prompt visível do Windows)
 * 2. Ligar/Standby Motor (Controle do fluxo de dados Python)
 * 3. Limpar Tudo (Banco de dados Supabase, RAM local e do servidor)
 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const { Dom, EventBus, Store, Logger } = window.Z;

    const btnShutdownTerminal = document.getElementById('btn-shutdown-terminal');
    const btnToggleMotor = document.getElementById('btn-toggle-motor');
    const btnRunPythonHistory = document.getElementById('btn-run-python-history');
    const btnRenderChartHistory = document.getElementById('btn-render-chart-history');
    const btnClearDb = document.getElementById('btn-clear-db');
    const labelMotorStatus = document.getElementById('motor-status-label');

    // Suporte robusto para abertura direta local via protocolo file://
    const host = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

    // 1. Ação do Botão: Encerrar Terminal
    btnShutdownTerminal?.addEventListener('click', async () => {
        if (!confirm('🔌 Deseja realmente ENCERRAR totalmente o Zenith Terminal (Servidor e Motor)?\n\nIsso fechará a janela do prompt de comando e pausará a coleta.')) {
            return;
        }

        try {
            Logger.info('🛑 Solicitando encerramento total do terminal e motor...');
            btnShutdownTerminal.classList.add('active');
            
            const res = await fetch(`${host}/api/control/shutdown`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            const data = await res.json();
            Logger.info('✅ Comando de encerramento enviado:', data.message);
            
            alert('🔌 Zenith Terminal encerrado com sucesso!\n\nVocê pode fechar esta aba do navegador.');
        } catch (err) {
            Logger.error('❌ Falha ao encerrar terminal:', err.message);
            alert('Falha ao encerrar terminal: certifique-se de que o backend está online.');
        } finally {
            btnShutdownTerminal.classList.remove('active');
        }
    });

    // 2. Ação do Botão: Ligar/Standby Motor
    let isMotorRunning = true; // Valor padrão
    
    function updateMotorUI(running) {
        isMotorRunning = running;
        if (btnToggleMotor) {
            if (isMotorRunning) {
                btnToggleMotor.className = 'zenith-control-btn active';
                if (labelMotorStatus) labelMotorStatus.textContent = 'Motor: ON';
                btnToggleMotor.title = 'Colocar Motor em Stand-by (Pausar Coleta)';
            } else {
                btnToggleMotor.className = 'zenith-control-btn standby';
                if (labelMotorStatus) labelMotorStatus.textContent = 'Motor: STDBY';
                btnToggleMotor.title = 'Ligar Motor (Ativar Coleta de Dados)';
            }
        }
    }

    // Escuta alterações de status do motor vindo do Store/WebSocket
    Store.watch('motorRunning', (running) => {
        updateMotorUI(running ?? true);
    });

    btnToggleMotor?.addEventListener('click', () => {
        const nextState = !isMotorRunning;
        Logger.info(`🔌 Solicitando alteração de estado do motor para: ${nextState ? 'ATIVO' : 'STANDBY'}`);
        window.Z.DataBridge?.toggleMotor(nextState);
    });

    // 3. Ação do Botão: Autorizar Python a Ler e Gravar Histórico
    btnRunPythonHistory?.addEventListener('click', () => {
        Logger.info('🐍 Solicitando ao Python a importação do histórico para o banco...');
        window.Z.DataBridge?.runPythonHistory();
    });

    // Eventos de feedback do processamento Python do histórico
    EventBus.on('python:historyStart', () => {
        Logger.info('⏳ Importador Python de histórico iniciado...');
        if (btnRunPythonHistory) {
            btnRunPythonHistory.className = 'zenith-control-btn active';
            btnRunPythonHistory.style.color = '#38bdf8'; // Sky blue indica processamento
            btnRunPythonHistory.title = 'Python processando e enviando arquivos de histórico...';
            btnRunPythonHistory.disabled = true;
        }
    });

    EventBus.on('python:historyEnd', (success) => {
        Logger.info(`🏁 Importador Python finalizado. Sucesso: ${success}`);
        if (btnRunPythonHistory) {
            btnRunPythonHistory.className = 'zenith-control-btn';
            btnRunPythonHistory.style.color = '';
            btnRunPythonHistory.title = 'Autorizar Python a ler o histórico e gravar no banco';
            btnRunPythonHistory.disabled = false;
        }
        if (success) {
            alert('✅ Histórico carregado, de-duplicado e integrado no banco de dados com sucesso!\n\nAgora você pode clicar no botão "Montar Gráfico" (ao lado) para renderizar esses dados no canvas.');
        } else {
            alert('⚠️ Ocorreu um erro no Historico.py ou nenhum arquivo válido de histórico novo foi encontrado em c:\\FOOTPRINT.');
        }
    });

    // 4. Ação do Botão: Autorizar Gráfico a Montar Histórico do Banco
    btnRenderChartHistory?.addEventListener('click', async () => {
        const activeAssetObj = Store.get('activeAsset');
        const asset = activeAssetObj ? (activeAssetObj.ticker || activeAssetObj) : 'NQM6';
        
        Logger.info(`📊 Solicitando montagem do histórico no gráfico para o ativo: ${asset}...`);
        
        if (btnRenderChartHistory) {
            btnRenderChartHistory.className = 'zenith-control-btn active';
            btnRenderChartHistory.title = 'Montando gráfico a partir do banco de dados...';
        }

        try {
            await window.Z.DataBridge?.loadHistoryFromDb(asset);
        } catch (err) {
            Logger.error('❌ Falha ao montar histórico no gráfico:', err.message);
        } finally {
            setTimeout(() => {
                if (btnRenderChartHistory) {
                    btnRenderChartHistory.className = 'zenith-control-btn';
                    btnRenderChartHistory.title = 'Autorizar Gráfico a montar o histórico do banco';
                }
            }, 1000);
        }
    });

    // 5. Ação do Botão: Limpar Dados
    btnClearDb?.addEventListener('click', async () => {
        if (!confirm('🚨 ATENÇÃO: Isso irá DELETAR todos os dados de trades do banco de dados na nuvem (Supabase), limpar a RAM do servidor e zerar os cookies/configurações do seu navegador local. Deseja continuar?')) {
            return;
        }

        try {
            Logger.info('🧹 Solicitando limpeza total de banco e memórias...');
            
            // Limpa o banco no servidor
            const res = await fetch(`${host}/api/trades/clear`, { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            
            // Limpa as variáveis locais e o LocalStorage
            window.Z.CandleBuilder.reset();
            localStorage.removeItem('zenith_tabs');
            localStorage.removeItem('zenith_active_tab');
            
            Logger.info('✅ Limpeza total concluída!');
            alert('🧹 Zenith resetado com sucesso!\n\nO sistema será recarregado agora.');
            window.location.reload();
        } catch (err) {
            Logger.error('❌ Falha ao limpar banco de dados:', err.message);
            alert('Erro ao limpar banco. Certifique-se de que o servidor local está respondendo na porta 3000.');
        }
    });

    // Sincroniza estado inicial do motor do Store
    updateMotorUI(Store.get('motorRunning') ?? true);
});
