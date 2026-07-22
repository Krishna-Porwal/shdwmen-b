const { query } = require('./dist/db/connection.js');
const { detectReviewSchemaInfo, buildReviewJoinCondition, buildReviewSelectExpressions } = require('./dist/utils/reviewCompatibility.js');

(async () => {
  const info = await detectReviewSchemaInfo((sql) => query(sql));
  console.log(JSON.stringify(info, null, 2));
  console.log('join:', buildReviewJoinCondition(info, '$2'));
  console.log('expressions:', buildReviewSelectExpressions(info));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
