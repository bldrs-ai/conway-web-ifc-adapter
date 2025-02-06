# conway-web-ifc-adapter

## publish
```
git pull
git co -b release-tmp origin/main
yarn upgrade @bldrs-ai/conway@<major.minor.patch>
git ci -m 'conway: upgrade <previous version> to <major.minor.patch>'
PATCH=`git rev-list HEAD --count`
npm version <conway major.minor>.$PATCH
npm publish
git br -m <conway major.minor>.$PATCH
git push origin
# Send PR for review
```
