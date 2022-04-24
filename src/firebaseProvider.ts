import {
  BaseKey,
  CrudFilter,
  CrudFilters,
  CrudSorting,
  DataProvider,
  LiveEvent,
  MetaDataQuery,
  Pagination,
  LiveProvider,
} from "@pankod/refine-core";
import {
  getDatabase,
  ref,
  set,
  get,
  Database,
  remove,
  update,
  Unsubscribe,
  DataSnapshot,
  onValue,
  orderByChild,
  query,
  limitToLast,
} from "@firebase/database";
import { FirebaseApp } from "@firebase/app";

const applyFilter = (
  data: any[] | undefined,
  filter: CrudFilter
): any[] | undefined => {
  if (filter.operator == "or" || !data) return;

  let filterFn: (value: any) => boolean;

  switch (filter.operator) {
    case "eq":
      filterFn = (value: any) => value == filter.value;
      break;
    case "ne":
      filterFn = (value: any) => value != filter.value;
      break;
    case "lt":
      filterFn = (value: any) => value < filter.value;
      break;
    case "gt":
      filterFn = (value: any) => value > filter.value;
      break;
    case "lte":
      filterFn = (value: any) => value <= filter.value;
      break;
    case "gte":
      filterFn = (value: any) => value >= filter.value;
      break;
    case "null":
      filterFn = (value: any) => !value;
      break;
    case "nnull":
      filterFn = (value: any) => !!value;
      break;
    case "in":
      filterFn = (value: any) => filter.value.includes(value);
      break;
    case "nin":
      filterFn = (value: any) => !filter.value.includes(value);
      break;
    default:
      filterFn = () => true;
  }

  let out = data.filter((obj: any) => {
    let value = obj;
    for (let f of filter.field.split(".")) {
      value = value[f];
    }

    return filterFn(value);
  });

  return out;
};

export const biggestIdPlusOneStrategy = async (
  provider: FirebaseDataProvider,
  resource: string
): Promise<number> => {
  const databaseRef = provider.getRef(resource);
  let snapshot = await get(databaseRef);

  if (snapshot?.exists()) {
    let data: any[] = snapshot.val();
    console.log(data);
    return (
      data
        .map((item) => Number(item.id))
        .reduce((max, current) => (current > max ? current : max), 0) + 1
    );
  } else {
    return Promise.reject("");
  }
};

// recommended
// To use this method as create-id generator, `.indexOn` rule must be set for .
// https://firebase.google.com/docs/database/security/indexing-data
export const biggestIdPlusOneStrategyIndexing = async (
  provider: FirebaseDataProvider,
  resource: string
): Promise<number> => {
  const databaseRef = query(
    provider.getRef(resource),
    orderByChild("id"),
    limitToLast(1)
  );
  let snapshot = await get(databaseRef);

  if (snapshot?.exists()) {
    let data: { [key: string]: any } = snapshot.val();
    console.log(data);
    let highestId = Object.values(data)[0].id;
    return highestId + 1;
  } else {
    return Promise.reject("");
  }
};

export class FirebaseDataProvider {
  database: Database;
  getCreateId: Function;

  constructor(firebaseApp: FirebaseApp, options?: { getCreateId?: Function }) {
    this.database = getDatabase(firebaseApp);
    this.getCreateId = options?.getCreateId || biggestIdPlusOneStrategy;
  }

  getRef(url: string) {
    return ref(this.database, url);
  }

  async createData<TVariables = {}>({
    resource,
    variables,
  }: {
    resource: string;
    variables: TVariables;
    metaData?: MetaDataQuery;
  }): Promise<any> {
    try {
      const id = await this.getCreateId(this, resource);
      const databaseRef = this.getRef(`${resource}/${id}`);
      const payload = {
        ...variables,
        id,
      };

      await set(databaseRef, payload);

      return { data: payload };
    } catch (error) {
      Promise.reject(error);
    }
  }

  async createManyData<TVariables = {}>(args: {
    resource: string;
    variables: TVariables[];
    metaData?: MetaDataQuery;
  }): Promise<any> {
    try {
      // Since createData waits getCreateId function during creation,
      // createData calls must be serialized to overcome id conflict.
      for (let item of args.variables) {
        await this.createData({ ...args, variables: item });
      }
    } catch (error) {
      Promise.reject(error);
    }
  }

  async deleteData<TVariables = {}>({
    resource,
    id,
  }: {
    resource: string;
    id: BaseKey;
    variables?: TVariables;
    metaData?: MetaDataQuery;
  }): Promise<any> {
    try {
      const databaseRef = this.getRef(`${resource}/${id}`);
      await remove(databaseRef);
    } catch (error) {
      Promise.reject(error);
    }
  }

  async deleteManyData<TVariables = {}>({
    ids,
    resource,
  }: {
    resource: string;
    ids: BaseKey[];
    variables?: TVariables;
    metaData?: MetaDataQuery;
  }): Promise<any> {
    try {
      await Promise.all(
        ids.map(async (id) => {
          return this.deleteData({ resource: resource, id });
        })
      );
    } catch (error) {
      Promise.reject(error);
    }
  }

  async getList({
    resource,
    pagination,
    sort,
    filters,
  }: {
    resource: string;
    pagination?: Pagination;
    sort?: CrudSorting;
    filters?: CrudFilters;
    metaData?: MetaDataQuery;
    dataProviderName?: string;
  }): Promise<any> {
    try {
      const databaseRef = this.getRef(resource);

      // TODO: use queries to sort and filter

      let snapshot = await get(databaseRef);

      if (snapshot?.exists()) {
        let data: any[] = Object.values(snapshot.val());

        if (filters) {
          let outData: any[] | undefined = data.slice();
          filters.forEach((filter) => {
            if (filter.operator == "or") {
              let childOut: (any[] | undefined)[] = [];
              for (let childFilter of filter.value) {
                childOut.push(applyFilter(outData, childFilter));
              }
              let newOut = childOut.flat().filter((item) => !!item);
              let union = new Set([...newOut]);
              outData = [];
              union.forEach((item) => {
                outData?.push(item);
              });
            } else {
              outData = applyFilter(outData, filter);
            }
          });
          data = outData;
        }

        if (sort && sort.length > 0) {
          data.sort((a: any, b: any) =>
            a[sort[0].field] < b[sort[0].field] ? -1 : 1
          );
          if (sort[0].order === "desc") {
            data = data.reverse();
          }
        }

        let total = data.length;
        // pagination
        const current = pagination?.current || 1;
        const pageSize = pagination?.pageSize || 10;

        let start = (current - 1) * pageSize;
        let end = current * pageSize;

        data = data.slice(start, end);

        return { data, total };
      } else {
        Promise.reject();
      }
    } catch (error) {
      Promise.reject(error);
    }
  }

  async getOne({
    resource,
    id,
  }: {
    resource: string;
    id: BaseKey;
    metaData?: MetaDataQuery;
  }): Promise<any> {
    try {
      const databaseRef = this.getRef(resource + "/" + id);

      let snapshot = await get(databaseRef);

      if (snapshot?.exists()) {
        let data = snapshot.val();

        return { data };
      } else {
        Promise.reject("");
      }
    } catch (error: any) {
      Promise.reject(error);
    }
  }

  async getMany({
    resource,
    ids,
  }: {
    resource: string;
    ids: BaseKey[];
    metaData?: MetaDataQuery;
    dataProviderName?: string;
  }): Promise<any> {
    try {
      const databaseRef = this.getRef(resource);

      let snapshot = await get(databaseRef);

      if (snapshot?.exists()) {
        let data = snapshot.val().filter((item: any) => ids.includes(item.id));

        return { data };
      } else {
        Promise.reject();
      }
    } catch (error) {
      Promise.reject(error);
    }
  }

  async updateData<TVariables = {}>({
    resource,
    id,
    variables,
  }: {
    resource: string;
    id: BaseKey;
    variables: TVariables;
    metaData?: MetaDataQuery;
  }): Promise<any> {
    try {
      const databaseRef = this.getRef(`${resource}/${id}`);

      await update(databaseRef, variables as {});

      return { data: variables };
    } catch (error) {
      Promise.reject(error);
    }
  }

  async updateManyData<TVariables = {}>({
    ids,
    resource,
    variables,
  }: {
    resource: string;
    ids: BaseKey[];
    variables: TVariables;
    metaData?: MetaDataQuery;
  }): Promise<any> {
    try {
      let data: Array<any> = [];
      ids.forEach(async (id: BaseKey) => {
        const result = this.updateData({
          resource,
          variables,
          id,
        });
        data.push(result);
      });
      return { data };
    } catch (error) {
      Promise.reject(error);
    }
  }

  async customMethod(): Promise<any> {
    throw "FirebaseProvider custom method not implemented";
  }

  getAPIUrl() {
    return "";
  }

  getProvider(): DataProvider {
    return {
      create: this.createData.bind(this),
      createMany: this.createManyData.bind(this),
      deleteOne: this.deleteData.bind(this),
      deleteMany: this.deleteManyData.bind(this),
      getList: this.getList.bind(this),
      getMany: this.getMany.bind(this),
      getOne: this.getOne.bind(this),
      update: this.updateData.bind(this),
      updateMany: this.updateManyData.bind(this),
      custom: this.customMethod.bind(this),
      getApiUrl: this.getAPIUrl.bind(this),
    };
  }
}

export class FirebaseLiveProvider {
  database: Database;
  constructor(firebaseApp: FirebaseApp) {
    this.database = getDatabase(firebaseApp);
  }

  getRef(url: string) {
    return ref(this.database, url);
  }

  subscribe(args: {
    channel: string;
    params?: {
      ids?: BaseKey[];
      [key: string]: any;
    };
    types: LiveEvent["type"][];
    callback: (event: any) => void;
  }): Unsubscribe {
    let { channel, callback } = args;
    const resource = channel.replace("resources/", "");
    const databaseRef = this.getRef(resource);

    let listener = (snapshot: DataSnapshot) => {
      callback({
        channel,
      });
    };

    // TODO: add types support

    return onValue(databaseRef, listener);
  }
  unsubscribe(unsub: Unsubscribe) {
    unsub();
  }
  getProvider(): LiveProvider {
    return {
      subscribe: this.subscribe.bind(this),
      unsubscribe: this.subscribe.bind(this),
    };
  }
}
