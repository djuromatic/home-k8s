import * as pulumi from "@pulumi/pulumi";
import * as kubernetes from "@pulumi/kubernetes";

const config = new pulumi.Config();
const kubernetesNamespace = config.require("kubernetesNamespace");
const appLabels = {
  app: "plex",
};

// Create a namespace (user supplies the name of the namespace)
const ingressNs = new kubernetes.core.v1.Namespace("plexns", {
  metadata: {
    labels: appLabels,
    name: kubernetesNamespace,
  }
});


const pvc = new kubernetes.core.v1.PersistentVolumeClaim("plex-data-pvc", {
  metadata: {
    name: "plex-data-pvc",
    namespace: ingressNs.metadata.name,
    annotations: {
      "pulumi.com/skipAwait": "true" // don't use the await logic at all
    }
  },
  spec: {
    accessModes: ["ReadWriteOnce"],
    resources: {
      requests: {
        storage: config.require("pvcSize")
      },
    },
  },
});

// Use Helm to install the Nginx ingress controller
const ingressController = new kubernetes.helm.v3.Release("plex", {
  chart: "plex",
  namespace: ingressNs.metadata.name,
  repositoryOpts: {
    repo: "https://utkuozdemir.org/helm-charts",
  },
  skipCrds: true,
  values: {
    ingress: {
      enabled: true,
      annotations: {
        "cert-manager.io/cluster-issuer": "lets-encrypt"
      },
      tls: [
        {
          hosts: [
            "plex.dmatic.xyz"
          ],
          secretName: "plex-tls-secret",
        }
      ],
      hosts: [
        {
          host: "plex.dmatic.xyz",
          paths: [
            {
              path: "/",
              pathType: "ImplementationSpecific"
            }
          ],
        }
      ],
    },
    service: {
      type: "NodePort"
    },
    persistence: {
      data: {
        enabled: true,
        existingClaim: pvc.metadata.name,
        isPvc: true
      }
    },
    controller: {
      enableCustomResources: false,
      appprotect: {
        enable: false,
      },
      appprotectdos: {
        enable: false,
      },
      service: {
        extraLabels: appLabels,
      },
    },
  },
});

const pvcQBitConfig = new kubernetes.core.v1.PersistentVolumeClaim("qbit-config-pvc", {
  metadata: {
    name: "qbit-config-pvc",
    namespace: ingressNs.metadata.name,
    annotations: {
      "pulumi.com/skipAwait": "true" // don't use the await logic at all
    }
  },
  spec: {
    accessModes: ["ReadWriteOnce"],
    resources: {
      requests: {
        storage: "2Gi"
      },
    },
  },
});

// Deployments and Services
const qbittorrent = new kubernetes.apps.v1.Deployment(
  "qbittorrent",
  {
    metadata: {
      name: "qbittorrent",
      namespace: kubernetesNamespace,
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          app: "qbittorrent",
        },
      },
      template: {
        metadata: {
          labels: {
            app: "qbittorrent",
          },
        },
        spec: {
          volumes: [
            {
              name: "config-storage",
              persistentVolumeClaim: {
                claimName: pvcQBitConfig.metadata.name
              }
            },
            {
              name: "download-storage",
              persistentVolumeClaim: {
                claimName: pvc.metadata.name
              }
            }
          ],
          containers: [
            {
              name: "qbittorrent",
              image: "lscr.io/linuxserver/qbittorrent:latest",
              ports: [
                {
                  containerPort: 8080,
                },
                {
                  containerPort: 6881,
                  protocol: "TCP",
                },
                {
                  containerPort: 6881,
                  protocol: "UDP",
                },
              ],
              env: [
                {
                  name: "PUID",
                  value: "1000",
                },
                {
                  name: "PGID",
                  value: "1000",
                },
                {
                  name: "TZ",
                  value: "Etc/UTC",
                },
                {
                  name: "WEBUI_PORT",
                  value: "8080",
                },
              ],
              volumeMounts: [
                {
                  mountPath: "/config",
                  name: "config-storage"
                },
                {
                  mountPath: "/downloads",
                  name: "download-storage"
                }
              ]
            },
          ],
        },
      },
    },
  },
);


const service = new kubernetes.core.v1.Service(
  "qbittorrent-service",
  {
    metadata: {
      name: "qbittorrent-service",
      namespace: kubernetesNamespace,
    },
    spec: {
      selector: qbittorrent.spec.template.metadata.labels,
      type: "NodePort",
      ports: [
        {
          name: "http-qbit",
          port: 8080,
          targetPort: 8080,
        },
        {
          name: "tcp-qbit",
          port: 6881,
          targetPort: 6881,
        },
        {
          name: "udp-qbit",
          port: 6881,
          targetPort: 6881,
          protocol: "UDP",
        },
      ],
    },
  },
);

const ingress = new kubernetes.networking.v1.Ingress(
  "qbittorrent-ingress",
  {
    metadata: {
      name: "qbittorrent-ingress",
      namespace: kubernetesNamespace,
      annotations: {
        "cert-manager.io/cluster-issuer": "lets-encrypt"
      },
    },
    spec: {
      rules: [
        {
          host: "qb.dmatic.xyz", // Update with your domain
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: {
                    name: service.metadata.name,
                    port: {
                      number: 8080,
                    },
                  },
                },
              },
            ],
          },
        },
      ],
      tls: [
        {
          hosts: ["qb.dmatic.xyz"], // Update with your domain
          secretName: "qb-tls-secret",
        },
      ],
    },
  },
);
// Export some values for use elsewhere
export const name = ingressController.name;
