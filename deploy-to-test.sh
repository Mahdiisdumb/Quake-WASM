DEPLOY_BUCKET=us-east-2-webquake-netquakeio-test

npm run build

aws s3 sync dist/app s3://$DEPLOY_BUCKET
aws s3 sync static s3://$DEPLOY_BUCKET/static
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/quake --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/singleplayer --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/multiplayer --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/setup/assets --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/setup/config --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/setup/autoexec --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/privacy --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
aws s3 cp dist/app/index.html s3://$DEPLOY_BUCKET/slicnse --metadata-directive REPLACE --cache-control  max-age=0,no-cache,no-store,must-revalidate
