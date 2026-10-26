# Evidências — Kubernetes no Minikube

Capturadas em 26/10/2026 com a aplicação rodando no cluster Minikube local. Todas as saídas vêm de comandos reais executados contra o cluster.

| Arquivo | O que comprova |
|---|---|
| `01-aplicacao-navegador.png` | Aplicação carregada pelo navegador, listando as tarefas do MongoDB |
| `02-aplicacao-chrome-tarefa-criada.jpg` | Uso real no Google Chrome: tarefa criada e outra marcada como concluída |
| `03-kubectl-get-pods.png` | `kubectl get pods -o wide`: 3 back-ends, 2 front-ends e 1 banco em `Running` |
| `04-kubectl-get-services.png` | `kubectl get services`: `frontend` NodePort 30080, `backend` e `mongo` ClusterIP |
| `05-kubectl-get-deployments.png` | `kubectl get deployments`: réplicas `3/3`, `2/2` e `1/1` |
| `06-configmaps-secrets-pvc.png` | ConfigMaps, Secret (só os tamanhos, sem o valor) e volume persistente `Bound` |
| `07-balanceamento-de-carga.png` | Requisições a `/api/whoami` distribuídas entre os 3 Pods do back-end |
| `08-recriacao-automatica-pod.png` | Pod do back-end apagado e recriado automaticamente pelo Deployment |
| `09-persistencia-do-banco.png` | Pod do MongoDB apagado e recriado sem perda de dados (PVC) |
| `10-logs-estruturados.png` | Logs JSON dos Pods do back-end (`kubectl logs`) |
| `11-demo-aplicacao-chrome.gif` | Gravação do uso real no Chrome: criar, concluir e excluir uma tarefa |
| `saida-comandos.txt` | Saída em texto dos mesmos comandos |
