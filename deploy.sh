#!/bin/bash
git push
gcloud run deploy gsc-app \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --port 3000 \
  --env-vars-file /tmp/cloudrun.env.yaml
