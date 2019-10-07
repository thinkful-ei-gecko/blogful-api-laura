const { expect } = require('chai');
const knex = require('knex');
const app = require('../src/app.js');
const { makeArticlesArray, makeMaliciousArticle } = require('./articles.fixtures.js');

describe.only('Articles Endpoints', function() {
  let db;
  before('make knex instance', () => {
    db = knex({
      client: 'pg',
      connection: process.env.TEST_DB_URL,
    });
    app.set('db', db);
  });
  after('disconnect from db', () => db.destroy());
  before('clean the table', () => db('blogful_articles').truncate());
  afterEach('cleanup', () => db('blogful_articles').truncate());

  describe('GET /api/articles', () => {
    context(`Given no articles`, () => {
      it(`responds with 200 and an empty list`, () => {
        return supertest(app).get('/api/articles').expect(200, [])
      });
    });

    context('Given there are articles in the database', () => {
      const testArticles = makeArticlesArray();

      beforeEach('insert articles', () => {
        return db.into('blogful_articles').insert(testArticles)
      });
      it('responds with 200 and all of the articles', () => {
        return supertest(app).get('/api/articles').expect(200)
          .then(res => expect(testArticles).to.eql(res.body.map(article => ({
            ...article,
            date_published: new Date(article.date_published)
          }))));
      });
    });
    
    context(`Given an XSS attack article`, () => {
      const { maliciousArticle, expectedArticle } = makeMaliciousArticle();

      beforeEach('insert malicious article', () => {
        return db.into('blogful_articles').insert([ maliciousArticle ])
      });

      it('removes XSS attack content', () => {
        return supertest(app).get(`/api/articles`).expect(200)
          .expect(res => {
            expect(res.body[0].title).to.eql(expectedArticle.title)
            expect(res.body[0].content).to.eql(expectedArticle.content)
          })
      });
    });
  });

  describe('GET /api/articles/:article_id', () => {
    context(`Given no articles`, () => {
      it(`responds with 404`, () => {
        const articleId = 123456;
        return supertest(app).get(`/api/articles/${articleId}`)
          .expect(404, { error: { message: `Article doesn't exist` } })
      });
    });

    context('Given articles in database', () => {
      const testArticles = makeArticlesArray();

      beforeEach('insert articles', () => {
        return db.into('blogful_articles').insert(testArticles)
      });
      it('responds with 200 and the specified article', () => {
        const articleId = 2;
        const expectedArticle = testArticles[articleId - 1];
        return supertest(app).get(`/api/articles/${articleId}`).expect(200)
          .then(res => {
            expect(expectedArticle).to.eql({
            ...res.body,
            date_published: new Date(res.body.date_published)
            });
          });
      });
    });

    context(`Given an XSS attack article`, () => {
      const maliciousArticle = {
        id: 911,
        title: 'Naughty naughty very naughty <script>alert("xss");</script>',
        style: 'How-to',
        content: `Bad image <img src="https://url.to.file.which/does-not.exist" onerror="alert(document.cookie);">. But not <strong>all</strong> bad.`
      };
      beforeEach('insert malicious article', () => { return db.into('blogful_articles').insert([ maliciousArticle ]); });
      
      it('removes XSS attack content', () => {
        return supertest(app)
          .get(`/api/articles/${maliciousArticle.id}`)
          .expect(200)
          .expect(res => {
            expect(res.body.title).to.eql('Naughty naughty very naughty &lt;script&gt;alert(\"xss\");&lt;/script&gt;')
            expect(res.body.content).to.eql(`Bad image <img src="https://url.to.file.which/does-not.exist">. But not <strong>all</strong> bad.`)
          });
      });
    });
  });   

  describe(`POST /api/articles`, () => {
    it(`creates an article, responds with 201 and the new article`,  function() {
      this.retries(3);
      const newArticle = {
        title: 'Test new article',
        style: 'Listicle',
        content: 'Test new article content...'
      };
      return supertest(app).post('/api/articles')
        .send(newArticle).expect(201)
        .expect(res => {
          expect(res.body.title).to.equal(newArticle.title)
          expect(res.body.style).to.equal(newArticle.style)
          expect(res.body.content).to.equal(newArticle.content)
          expect(res.body).to.have.property('id')
          expect(res.headers.location).to.eql(`/api/articles/${res.body.id}`)
          const expected = new Date().toLocaleString('en', { timeZone: 'UTC' });
          const actual = new Date(res.body.date_published).toLocaleString();
          expect(actual).to.eql(expected)
        })
        .then(postRes => 
          supertest(app)
            .get(`/api/articles/${postRes.body.id}`)
            .expect(postRes.body)
        )
    });
    it(`responds with 400 and an error message when the 'title' is missing`, () => {
      return supertest(app)
        .post('/api/articles')
        .send({
          style: 'Listicle',
          content: 'Test new article content...'
        })
        .expect(400, { error: { message: `Missing 'title' in request body` } });
    });
    it(`responds with 400 and an error message when the 'content' is missing`, () => {
      return supertest(app)
        .post('/api/articles')
        .send({
          title: 'Test new article',
          style: 'Listicle',
        })
        .expect(400, {
          error: { message: `Missing 'content' in request body` }
        });
    });
    it(`responds with 400 and an error message when the 'style' is missing`, () => {
      return supertest(app)
        .post('/api/articles')
        .send({
          title: 'Test new article',
          content: 'Test new article content...'
        })
        .expect(400, {
          error: { message: `Missing 'style' in request body` }
        });
    });
    it('removes XSS attack content from response', () => {
      const { maliciousArticle, expectedArticle } = makeMaliciousArticle()
      return supertest(app).post(`/api/articles`).send(maliciousArticle)
        .expect(201)
        .expect(res => {
          expect(res.body.title).to.eql(expectedArticle.title)
          expect(res.body.content).to.eql(expectedArticle.content)
        });
    });


  });

  describe(`DELETE /api/articles/:article_id`, () => {

    context('Given there are articles in the database', () => {
      const testArticles = makeArticlesArray();

      beforeEach('insert articles', () => { return db.into('blogful_articles').insert(testArticles) });
 
      it('responds with 204 and removes the article', () => {
        const idToRemove = 2;
        const expectedArticles = testArticles.filter(article => article.id !== idToRemove);
        return supertest(app).delete(`/api/articles/${idToRemove}`)
          .expect(204)
          .then(res => {
            console.log(res);
            return supertest(app)
            .get(`/api/articles`)
            // .expect(expectedArticles)
            .then(res => expect(expectedArticles).to.eql(res.body.map(article => ({
              ...article,
              date_published: new Date(article.date_published)
            }))))
          });
      });
    });

    context(`Given no articles`, () => {
      it(`responds with 404`, () => {
        const articleId = 123456;
        return supertest(app)
          .delete(`/api/articles/${articleId}`)
          .expect(404, { error: { message: `Article doesn't exist` } });
      });
    });

  });  

  describe.only(`PATCH /api/articles/:article_id`, () => {
    context(`Given no articles`, () => {
      it(`responds with 404`, () => {
        const articleId = 123456;
        return supertest(app)
          .patch(`/api/articles/${articleId}`)  // DELETE HERE?? instead of patch
          .expect(404, { error: { message: `Article doesn't exist` } });
      });
    });

    context('Given there are articles in the database', () => {
      const testArticles = makeArticlesArray();

      beforeEach('insert articles', () => {
         return db('blogful_articles').insert(testArticles)
       });
    
      it('responds with 204 and updates the article', () => {
        const idToUpdate = 2;
        const updateArticle = {
          title: 'updated article title',
          style: 'Interview',
          content: 'updated article content',
        };
        const expectedArticle = {
          ...testArticles[idToUpdate - 1],
          ...updateArticle
        };
        return supertest(app)
          .patch(`/api/articles/${idToUpdate}`)
          .send(updateArticle)
          .expect(204)
          .then(res =>
            supertest(app)
              .get(`/api/articles/${idToUpdate}`)
              .expect(expectedArticle)
          );
      });

      it(`responds with 400 when no required fields supplied`, () => {
        const idToUpdate = 2;
        return supertest(app)
          .patch(`/api/articles/${idToUpdate}`)
          .send({ irrelevantField: 'foo' })
          .expect(400, {
            error: {
              message: `Request body must contain either 'title', 'style' or 'content'`
              }
          });
      });
      
      it(`responds with 204 when updating only a subset of fields`, () => {
        const idToUpdate = 2;
        const updateArticle = { title: 'updated article title', };
        const expectedArticle = {
          ...testArticles[idToUpdate - 1],
          ...updateArticle
        };
        return supertest(app)
          .patch(`/api/articles/${idToUpdate}`)
          .send({
            ...updateArticle,
            fieldToIgnore: 'should not be in GET response'
          })
          .expect(204)
          .then(res =>
            supertest(app)
              .get(`/api/articles/${idToUpdate}`)
              .expect(expectedArticle)
          )
      });


    });

  });
});


   
