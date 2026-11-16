```text
crankpath 0.1.0
scanned: repo "http://gitea-http.gitea:3000/ops/thin-slice" (from --repo-url)
    commit: not read in this build  floating: no
Run status: ANALYSED WITH GAPS
  gaps: 1 source opaque; 2 objects skipped
Cycles: 1 uncranked
drawn: every node and edge of the graph as read (6 nodes, 9 edges); the run has
    gaps, listed above, so the estate may hold more
```

```mermaid
flowchart LR
  n1["Application #34;argocd/gitea#34;"]
  n2["Application #34;argocd/notes#34;, opaque: unreadable-file"]:::opaque
  n3["ConfigMap #34;gitea/gitea-config#34;"]
  n4["Deployment #34;gitea/gitea#34;"]
  n5["Secret #34;gitea/gitea-admin#34;"]
  n6["Service #34;gitea/gitea-http#34;"]
  n1 ==>|"reads-source, extracted, on cycle c-d8197e7d"| n6
  n2 -->|"reads-source, extracted"| n6
  n3 ==>|"deployed-by, extracted, on cycle c-d8197e7d"| n1
  n4 ==>|"deployed-by, extracted, on cycle c-d8197e7d"| n1
  n4 ==>|"needs-config, extracted, on cycle c-d8197e7d"| n3
  n4 ==>|"needs-secret, extracted, on cycle c-d8197e7d"| n5
  n5 ==>|"deployed-by, extracted, on cycle c-d8197e7d"| n1
  n6 ==>|"deployed-by, extracted, on cycle c-d8197e7d"| n1
  n6 ==>|"selects, extracted, on cycle c-d8197e7d"| n4
  subgraph legend["Legend"]
    direction LR
    legend1["thick arrow: an edge on a cycle"]
    legend2["thin arrow: an extracted edge on no cycle"]
    legend3["dotted arrow: a declared edge, unverified"]
    legend4["dashed border: an opaque node"]:::opaque
  end
  classDef opaque stroke-dasharray: 5 5
```

```text
Text fallback: the nodes and edges drawn above.
nodes: 6
  n1  Application "argocd/gitea"
  n2  Application "argocd/notes"  opaque: unreadable-file
  n3  ConfigMap "gitea/gitea-config"
  n4  Deployment "gitea/gitea"
  n5  Secret "gitea/gitea-admin"
  n6  Service "gitea/gitea-http"
edges: 9 (from -> to  kind  source)
  Application "argocd/gitea" -> Service "gitea/gitea-http"  reads-source
      extracted  cycle: c-d8197e7d
  Application "argocd/notes" -> Service "gitea/gitea-http"  reads-source
      extracted
  ConfigMap "gitea/gitea-config" -> Application "argocd/gitea"  deployed-by
      extracted  cycle: c-d8197e7d
  Deployment "gitea/gitea" -> Application "argocd/gitea"  deployed-by  extracted
      cycle: c-d8197e7d
  Deployment "gitea/gitea" -> ConfigMap "gitea/gitea-config"  needs-config
      extracted  cycle: c-d8197e7d
  Deployment "gitea/gitea" -> Secret "gitea/gitea-admin"  needs-secret
      extracted  cycle: c-d8197e7d
  Secret "gitea/gitea-admin" -> Application "argocd/gitea"  deployed-by
      extracted  cycle: c-d8197e7d
  Service "gitea/gitea-http" -> Application "argocd/gitea"  deployed-by
      extracted  cycle: c-d8197e7d
  Service "gitea/gitea-http" -> Deployment "gitea/gitea"  selects  extracted
      cycle: c-d8197e7d
```
