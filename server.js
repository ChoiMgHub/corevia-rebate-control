const http=require('node:http');
const {loadData}=require('./server/data.cjs');
const {createHandler}=require('./server/routes.cjs');
const {review}=require('./ai-review.cjs');
const {Repository}=require('./server/database.cjs');
const {createService}=require('./server/command-service.cjs');
const {createDailyLimit,guardReview}=require('./server/ai-limit.cjs');
const path=require('node:path');
function createServer(options={}){
  const data=loadData(__dirname),repository=options.repository||new Repository(options.dbPath||process.env.OPERATIONS_DB_PATH||path.join(__dirname,'data','operations.sqlite'));
  // 공개 배포에서는 AI_DAILY_LIMIT로 하루 호출 횟수를 제한한다. 설정하지 않으면(로컬) 제한이 없다.
  const limiter=createDailyLimit(Number(options.aiDailyLimit??process.env.AI_DAILY_LIMIT)||0);
  const service=createService({repository,data,review:guardReview(options.review||review,limiter)});
  const server=http.createServer(createHandler({root:__dirname,data,service}));
  server.repository=repository;
  server.on('close',()=>repository.close());
  return server;
}
if(require.main===module){
  const server=createServer();
  const port=Number(process.env.PORT)||3217;
  server.on('error',error=>{if(error.code!=='EADDRINUSE')throw error;console.error(`포트 ${port}을 다른 프로그램이 쓰고 있습니다. 이미 켜 둔 서버가 있으면 그 창에서 Ctrl+C로 끄거나, 다른 포트로 실행하세요: set PORT=3218 후 node server.js`);try{server.repository.close()}catch{}process.exit(1)});
  server.listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}`));
  // Ctrl+C: stop accepting connections, release the DB lock, then exit.
  const stop=()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref()};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  process.on('exit',()=>{try{server.repository.close()}catch{}});
}
module.exports={createServer};
