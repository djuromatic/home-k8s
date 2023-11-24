import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

const config = new pulumi.Config();
const domain = config.require("domain");
const namespace = config.require("namespace")
const serviceName = "plex-service"
const appLabel = "plex"

const ingressNs = new k8s.core.v1.Namespace("plexns", {
  metadata: {
    name: namespace,
  }
});

const ingress = new k8s.networking.v1.Ingress("plex-ingress", {
  metadata: {
    name: "plex-ingress",
    namespace,
    annotations: {
      "cert-manager.io/cluster-issuer": "lets-encrypt"
    },
  },
  spec: {
    tls: [{
      hosts: [
        domain
      ],
      secretName: "plex-tls-secret",
    }
    ],
    rules: [
      {
        host: domain,
        http: {
          paths: [
            {
              path: "/",
              pathType: "Prefix",
              backend: {
                service: {
                  name: serviceName,
                  port: { number: 32400 }, // This should be the port where your service is running
                },
              },
            },
          ],
        },
      },
    ],
  },
});

const plexService = new k8s.core.v1.Service("plex-service", {
  metadata: { name: serviceName, namespace },
  spec: {
    type: "NodePort",
    selector: { app: appLabel }, // Replace with your app label selector
    ports: [{ port: 32400, targetPort: 32400 }], // Replace with your service port
  },
});

const plexDeployment = new k8s.apps.v1.Deployment("plex-deployment", {
  metadata: { namespace },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: appLabel } },
    template: {
      metadata: { labels: { app: appLabel } },
      spec: {
        containers: [
          {
            name: appLabel,
            image: "linuxserver/plex:latest", // Replace with your Plex image
            ports: [{ containerPort: 32400 }], // Replace with your Plex service port
          },
        ],
      },
    },
  },
});

// Export the Kubernetes cluster kubeconfig
export const kubeconfig = pulumi.output("test");

