import * as pulumi from "@pulumi/pulumi";
import * as kubernetes from "@pulumi/kubernetes";

const config = new pulumi.Config();
const k8sNamespace = config.require("k8sNamespace");
const appLabels = {
  app: "plex",
};

// Create a namespace (user supplies the name of the namespace)
const ingressNs = new kubernetes.core.v1.Namespace("plexns", {
  metadata: {
    labels: appLabels,
    name: k8sNamespace,
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

// Export some values for use elsewhere
export const name = ingressController.name;
