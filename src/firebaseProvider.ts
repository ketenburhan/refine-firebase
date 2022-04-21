import {
  BaseRecord,
  CreateManyResponse,
  CreateResponse,
  CrudFilter,
  CrudFilters,
  CrudSorting,
  CustomResponse,
  DeleteManyResponse,
  DeleteOneResponse,
  GetListResponse,
  GetManyResponse,
  GetOneResponse,
  MetaDataQuery,
  Pagination,
  UpdateManyResponse,
  UpdateResponse,
} from "@pankod/refine-core";
import {
  getDatabase,
  ref,
  set,
  get,
  Database,
  remove,
  update,
} from "@firebase/database";
import { FirebaseApp } from "@firebase/app";

declare interface ICreateData<TVariables> {
  resource: string;
  variables: TVariables;
  metaData?: MetaDataQuery;
}

declare interface IDeleteData {
  resource: string;
  id: string;
  metaData?: MetaDataQuery;
}

declare interface IDeleteManyData {
  resource: string;
  ids: string[];
  metaData?: MetaDataQuery;
}

declare interface IGetList {
  resource: string;
  pagination?: Pagination;
  sort?: CrudSorting;
  filters?: CrudFilters;
  metaData?: MetaDataQuery;
}

declare interface IGetOne {
  resource: string;
  id: string;
  metaData?: MetaDataQuery;
}

declare interface IGetMany extends Omit<IGetOne, "id"> {
  ids: Array<string>;
}

declare interface IUpdateData<TVariables> extends ICreateData<TVariables> {
  id?: string;
}

declare interface IUpdateManyData<TVariables> extends ICreateData<TVariables> {
  ids: Array<string>;
}

interface IDataContextProvider {
  getList: <TData extends BaseRecord = BaseRecord>(params: {
    resource: string;
    pagination?: Pagination;
    sort?: CrudSorting;
    filters?: CrudFilters;
    metaData?: MetaDataQuery;
  }) => Promise<GetListResponse<TData>>;
  getMany: <TData extends BaseRecord = BaseRecord>(params: {
    resource: string;
    ids: string[];
    metaData?: MetaDataQuery;
  }) => Promise<GetManyResponse<TData>>;
  getOne: <TData extends BaseRecord = BaseRecord>(params: {
    resource: string;
    id: string;
    metaData?: MetaDataQuery;
  }) => Promise<GetOneResponse<TData>>;
  create: <TData extends BaseRecord = BaseRecord, TVariables = {}>(params: {
    resource: string;
    variables: TVariables;
    metaData?: MetaDataQuery;
  }) => Promise<CreateResponse<TData>>;
  createMany: <TData extends BaseRecord = BaseRecord, TVariables = {}>(params: {
    resource: string;
    variables: TVariables[];
    metaData?: MetaDataQuery;
  }) => Promise<CreateManyResponse<TData>>;
  update: <TData extends BaseRecord = BaseRecord, TVariables = {}>(params: {
    resource: string;
    id: string;
    variables: TVariables;
    metaData?: MetaDataQuery;
  }) => Promise<UpdateResponse<TData>>;
  updateMany: <TData extends BaseRecord = BaseRecord, TVariables = {}>(params: {
    resource: string;
    ids: string[];
    variables: TVariables;
    metaData?: MetaDataQuery;
  }) => Promise<UpdateManyResponse<TData>>;
  deleteOne: <TData extends BaseRecord = BaseRecord>(params: {
    resource: string;
    id: string;
    metaData?: MetaDataQuery;
  }) => Promise<DeleteOneResponse<TData>>;
  deleteMany: <TData extends BaseRecord = BaseRecord>(params: {
    resource: string;
    ids: string[];
    metaData?: MetaDataQuery;
  }) => Promise<DeleteManyResponse<TData>>;
  getApiUrl: () => string;
  custom?: <TData extends BaseRecord = BaseRecord>(params: {
    url: string;
    method: "get" | "delete" | "head" | "options" | "post" | "put" | "patch";
    sort?: CrudSorting;
    filters?: CrudFilter[];
    payload?: {};
    query?: {};
    headers?: {};
    metaData?: MetaDataQuery;
  }) => Promise<CustomResponse<TData>>;
}

const applyFilter = (
  data: any[] | undefined,
  filter: CrudFilter
): any[] | undefined => {
  if (filter.operator == "or" || !data) return;

  let out = data.filter((obj: any) => {
    let value = obj;
    for (let f of filter.field.split(".")) {
      value = value[f];
    }
    switch (filter.operator) {
      case "eq":
        return value == filter.value;
      case "ne":
        return value != filter.value;
      case "lt":
        return value < filter.value;
      case "gt":
        return value > filter.value;
      case "lte":
        return value <= filter.value;
      case "gte":
        return value >= filter.value;
      case "null":
        return !value;
      case "nnull":
        return !!value;
      case "in":
        return filter.value.includes(value);
      case "nin":
        return !filter.value.includes(value);
      default:
        return true;
    }
  });

  return out;
};

const biggestIdPlusOneStrategy = async (
  provider: FirebaseDataProvider,
  resource: string
): Promise<number> => {
  const databaseRef = provider.getRef(resource);
  let snapshot = await get(databaseRef);

  if (snapshot?.exists()) {
    let data: any[] = snapshot.val();
    return (
      data
        .map((item) => Number(item.id))
        .reduce((max, current) => (current > max ? current : max), 0) + 1
    );
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

  async createData<TVariables = {}>(
    args: ICreateData<TVariables>
  ): Promise<any> {
    try {
      const id = await this.getCreateId(this, args.resource);
      const databaseRef = this.getRef(`${args.resource}/${id}`);
      const payload = {
        ...args.variables,
        id,
      };

      await set(databaseRef, payload);

      return { data: payload };
    } catch (error) {
      Promise.reject(error);
    }
  }

  async createManyData<TVariables = {}>(
    args: ICreateData<TVariables[]>
  ): Promise<any> {
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

  async deleteData({ resource, id }: IDeleteData): Promise<any> {
    try {
      const databaseRef = this.getRef(`${resource}/${id}`);
      await remove(databaseRef);
    } catch (error) {
      Promise.reject(error);
    }
  }

  async deleteManyData({ ids, resource }: IDeleteManyData): Promise<any> {
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
  }: IGetList): Promise<any> {
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

  async getOne(args: IGetOne): Promise<any> {
    try {
      const databaseRef = this.getRef(args.resource + "/" + args.id);

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

  async getMany(args: IGetMany): Promise<any> {
    try {
      let { resource, ids } = args;
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

  async updateData<TVariables = {}>(
    args: IUpdateData<TVariables>
  ): Promise<any> {
    try {
      const databaseRef = this.getRef(`${args.resource}/${args.id}`);

      await update(databaseRef, args.variables as {});

      return { data: args.variables };
    } catch (error) {
      Promise.reject(error);
    }
  }

  async updateManyData<TVariables = {}>(
    args: IUpdateManyData<TVariables>
  ): Promise<any> {
    try {
      let data: Array<any> = [];
      args.ids.forEach(async (id: string) => {
        const result = this.updateData({
          resource: args.resource,
          variables: args.variables,
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

  getProvider(): IDataContextProvider {
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
