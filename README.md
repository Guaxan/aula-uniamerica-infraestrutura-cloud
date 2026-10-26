# Lista de Tarefas no Kubernetes (Minikube)

Migração da aplicação do Mensal 1 (to-do list: React + Node.js/Express + MongoDB) para um cluster Kubernetes local com Minikube.

Grupo devopszudos · Infraestrutura Cloud · UniAmérica · Prof. Laércio

---

## Arquitetura

```
                 Navegador
                     │  http://<minikube>:30080
                     ▼
        ┌─── Service "frontend" (NodePort 30080) ───┐
        │                                            │
   Pod frontend                                Pod frontend        ← Deployment, 2 réplicas
   (nginx: serve o React e faz proxy de /api)
        │  http://backend:5000   (/api/todos → /todos)
        ▼
        ┌──── Service "backend" (ClusterIP 5000) ────┐
        │                    │                       │             ← kube-proxy balanceia
   Pod backend          Pod backend            Pod backend         ← Deployment, 3 réplicas
        │  mongodb://mongo:27017
        ▼
        Service "mongo" (ClusterIP 27017)
                     │
                 Pod mongo  ── PersistentVolumeClaim "mongo-data" (1 Gi)
```

| Componente | Recurso Kubernetes | Réplicas | Exposição |
|---|---|---|---|
| Front-end (React compilado + nginx) | Deployment `frontend` + Service `frontend` | 2 | **NodePort 30080**: único ponto de entrada |
| Back-end (Node.js + Express) | Deployment `backend` + Service `backend` | 3 | ClusterIP: só dentro do cluster |
| Banco (MongoDB 7) | Deployment `mongo` + Service `mongo` + PVC `mongo-data` | 1 | ClusterIP: só dentro do cluster |
| Configuração | ConfigMap `backend-config`, ConfigMap `frontend-nginx` | — | — |
| Credenciais do banco | Secret `mongo-credentials` | — | — |

### Como os componentes se comunicam

1. O navegador acessa o **Service `frontend`** (NodePort). Ele entrega a página React e o JavaScript.
2. O React chama a API em **`/api/...`**, no mesmo endereço da página. Por isso não existe problema de CORS, e o back-end nunca fica exposto ao navegador.
3. O **nginx** do Pod de front-end recebe `/api/...`, remove o prefixo e repassa para `http://backend:5000/...`. A configuração dele vem do ConfigMap `frontend-nginx`.
4. `backend` é o nome do **Service** do back-end. O DNS interno do cluster (CoreDNS) resolve esse nome para um IP fixo (ClusterIP), e o **kube-proxy** distribui cada conexão entre os 3 Pods. **É aí que acontece o balanceamento de carga.**
5. Cada Pod do back-end conecta no MongoDB por `mongodb://...@mongo:27017`, em que `mongo` é o nome do Service do banco. Usuário e senha vêm do **Secret** `mongo-credentials`.
6. O MongoDB grava em `/data/db`, montado num **PersistentVolumeClaim**. Se o Pod do banco for apagado, o novo Pod reaproveita o mesmo disco e os dados continuam lá.

### Por que não ficou a parte serverless?

No Mensal 1 (AWS), o back-end virou Lambda e o banco virou DynamoDB, porque o DocumentDB não estava disponível no plano gratuito da conta. No Kubernetes não existe essa restrição, então a aplicação voltou ao motor original do projeto, o MongoDB, e o Express voltou a ser um servidor (`app.listen`). Os logs estruturados em JSON da Segunda Entrega foram mantidos (`request_completed`, `db_call`), agora com o campo `pod` indicando qual réplica atendeu.

### Recursos de disponibilidade usados

- **Réplicas:** 3 Pods de back-end e 2 de front-end. O Deployment mantém essa quantidade sempre.
- **Autorrecuperação:** se um Pod é apagado ou cai, o ReplicaSet do Deployment cria outro automaticamente.
- **readinessProbe** (`GET /health`): o Pod de back-end só recebe tráfego quando já está conectado ao banco.
- **livenessProbe:** se o processo travar, o Kubernetes reinicia o container.
- **Banco com `strategy: Recreate`:** como o disco é `ReadWriteOnce`, nunca existem dois Pods do Mongo disputando o mesmo volume.

---

## Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) (Docker Desktop, ou Colima no macOS)
- [Minikube](https://minikube.sigs.k8s.io/docs/start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- Pelo menos 4 GB de RAM livres para o Docker

No macOS com Homebrew:

```bash
brew install minikube kubernetes-cli
# Se usar Colima, dê memória suficiente para o Minikube:
colima start --cpu 4 --memory 4
```

---

## Passo a passo

Todos os comandos rodam a partir da raiz do repositório.

### 1. Iniciar o Minikube

```bash
minikube start --driver=docker --cpus=2 --memory=3000
kubectl get nodes          # deve mostrar "minikube   Ready"
```

### 2. Disponibilizar as imagens no Minikube

As imagens são construídas **dentro** do Minikube, sem precisar de registry externo:

```bash
minikube image build -t todo-mongo:1.0    ./banco-de-dados
minikube image build -t todo-backend:1.0  ./backend
minikube image build -t todo-frontend:1.0 ./frontend

minikube image ls | grep todo   # as 3 imagens devem aparecer
```

### 3. Criar o Secret com as credenciais do banco

A senha não fica no repositório. Ela é gerada na hora:

```bash
kubectl create secret generic mongo-credentials \
  --from-literal=username=root \
  --from-literal=password="$(openssl rand -hex 16)"
```

### 4. Aplicar os manifestos

```bash
kubectl apply -f k8s/

kubectl rollout status deployment/mongo
kubectl rollout status deployment/backend
kubectl rollout status deployment/frontend
```

### 5. Acessar a aplicação

```bash
minikube service frontend --url
```

O comando imprime a URL (ex.: `http://127.0.0.1:52345`). Abra essa URL no navegador.

> No macOS e no Windows com driver Docker, **o terminal precisa ficar aberto**, porque o Minikube mantém um túnel até o cluster. No Linux a URL é direta: `http://$(minikube ip):30080`.

Alternativa que funciona em qualquer sistema:

```bash
kubectl port-forward service/frontend 8080:80
# abrir http://localhost:8080
```

---

## Demonstração (apresentação)

### Estado do cluster

```bash
kubectl get pods -o wide
kubectl get services
kubectl get deployments
```

### Balanceamento de carga

A rota `/whoami` do back-end devolve o nome do Pod que respondeu. Com a aplicação acessível em `$URL` (passo 5):

```bash
for i in $(seq 12); do curl -s $URL/api/whoami; echo; done
```

As respostas alternam entre os 3 Pods `backend-...`. Todas as respostas também trazem o cabeçalho `X-Served-By` com o nome do Pod.

### Recriação automática de um Pod

Terminal 1:

```bash
kubectl get pods -w
```

Terminal 2:

```bash
kubectl delete pod <nome-de-um-pod-backend>
```

No terminal 1 aparece o Pod antigo em `Terminating` e um **novo Pod**, com outro nome, indo para `Running`. O Deployment volta a ter 3 réplicas sem intervenção manual.

### Persistência do banco

1. Criar uma tarefa pela aplicação.
2. `kubectl delete pod -l app=mongo`
3. Esperar o novo Pod ficar `Running` (`kubectl get pods -w`) e recarregar a página: a tarefa continua lá.

### Logs estruturados

```bash
kubectl logs -l app=backend --tail=5 --prefix
```

### Evidências

Capturas de tela de todos os itens acima em [`evidencias/`](evidencias/README.md).

---

## Estrutura do repositório

```
.
├── backend/              Node.js + Express + Mongoose (Dockerfile)
├── frontend/             React + nginx (Dockerfile, nginx.conf)
├── banco-de-dados/       MongoDB + carga inicial init-mongo.js (Dockerfile)
├── k8s/
│   ├── 01-configmaps.yaml   ConfigMaps do back-end e do nginx
│   ├── 02-mongo.yaml        PVC + Deployment + Service do banco
│   ├── 03-backend.yaml      Deployment (3 réplicas) + Service do back-end
│   └── 04-frontend.yaml     Deployment (2 réplicas) + Service NodePort
├── evidencias/           Saídas dos comandos e capturas de tela
└── README.md
```

---

## Atualizar uma imagem depois de mudar o código

```bash
minikube image build -t todo-backend:1.0 ./backend
kubectl rollout restart deployment/backend
```

## Limpar tudo

```bash
kubectl delete -f k8s/
kubectl delete secret mongo-credentials
minikube stop        # ou: minikube delete
```

---

## Problemas comuns

| Sintoma | Causa | Correção |
|---|---|---|
| Pod em `ErrImagePull` / `ImagePullBackOff` | Imagem não foi construída dentro do Minikube | Refazer o passo 2 e conferir `minikube image ls` |
| Pod em `CreateContainerConfigError` | Secret `mongo-credentials` não existe | Refazer o passo 3 |
| Back-end `0/1 Ready` por muito tempo | Ainda sem conexão com o banco | `kubectl logs -l app=backend` e conferir se o Pod do `mongo` está `Running` |
| `minikube start` falha por memória | Docker com pouca RAM | Aumentar a memória do Docker Desktop/Colima para 4 GB |
| Mudou o Secret e o Mongo não aceita a nova senha | O usuário root só é criado na **primeira** inicialização do volume | `kubectl delete -f k8s/02-mongo.yaml` (apaga também o PVC) e aplicar de novo |
