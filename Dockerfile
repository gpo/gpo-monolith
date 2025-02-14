FROM node:23.8.0

ADD package.json /app/

WORKDIR /app
RUN npm install

ADD nest-cli.json /app/
ADD scripts /app/
ADD src /app/
ADD test /app/
ADD tsconfig.build.json /app/
ADD tsconfig.json /app/
